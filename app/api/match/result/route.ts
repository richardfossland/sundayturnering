import { ok, fail, readJson, rateLimit, ipKey, withApi } from "@/lib/server/http";
import type { Match } from "@/lib/types";
import { db, getMatch, getTournament } from "@/lib/server/store";
import { propagateAfterCommit } from "@/lib/server/propagate";
import { resultByFor } from "@/lib/server/pair";
import { toMatchDTO } from "@/lib/dto";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { checkControlCode, prefetchBlocked } from "@/lib/server/auth";
import { channels, events } from "@/lib/realtime";
import {
  validateResult,
  canonicaliseResult,
  resolve,
  isVoid,
} from "@/lib/tournament/scoring";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/match/result — submit a result with optimistic concurrency (spec
// §4.2). The control device sends the result_version it based the edit on; the
// RPC accepts only if it still matches, then bumps it. Loser → 409 conflict.
async function handlePOST(req: Request) {
  // Throttle score writes per client (the mutating match routes had no limit —
  // once a tournament's match ids are known, results could be spammed freely).
  if (!rateLimit(`match-result:${ipKey(req)}`, 600, 60_000))
    return fail(429, "for_mange_forsok");
  const body = await readJson<{
    matchId?: string;
    expectedVersion?: number;
    result?: Record<string, unknown>;
    deviceId?: string;
    deviceName?: string;
    /** Random per-device secret (never public): proves later that this phone
     * saved the result, see lib/server/pair.ts resultByFor. */
    deviceSecret?: string;
    controlCode?: string;
    requestId?: string;
  }>(req);
  if (!body?.matchId || typeof body.expectedVersion !== "number" || !body.result)
    return fail(400, "mangler_felt");
  // Optional idempotency key from the referee outbox (lib/client/outbox.ts).
  // Old clients send none and keep the exact legacy behaviour.
  if (body.requestId !== undefined && !(typeof body.requestId === "string" && UUID.test(body.requestId)))
    return fail(400, "ugyldig_foresporsel");
  const requestId = body.requestId;

  const m = await getMatch(body.matchId);
  if (!m) return fail(404, "finnes_ikke");
  if (m.status === "bye") return fail(409, "kan_ikke_endre_bye");
  // A finished match is edited via the organiser override (which re-propagates
  // the bracket) or the referee self-correct route; the plain result route must
  // not overwrite/re-propagate it. A repeat of a queued send (requestId) may
  // find the match done by its OWN first send: it is answered below instead.
  if (m.status === "done" && !requestId) return fail(409, "kamp_ferdig");
  if (!m.home_team_id || !m.away_team_id) return fail(409, "kamp_ikke_klar");

  const blocked = prefetchBlocked(req, m.tournament_id);
  const t = await getTournament(m.tournament_id).catch((e) => {
    blocked?.catch(() => {});
    throw e;
  });
  if (!t) return fail(404, "finnes_ikke");
  // Referee credential: the control code. Match ids alone are public.
  if (!(await checkControlCode(req, t, body.controlCode, blocked))) return fail(403, "feil_kontrollkode");

  // Replay of a send that already committed (the reply was lost): same outcome,
  // answered before the guards that the first send's own commit may now trip.
  if (requestId) {
    const { data: prior } = await db().rpc("result_request_outcome", {
      p_request_id: requestId,
      p_match_id: m.id,
    });
    if (prior) {
      // The first send may have committed but died before propagating the
      // bracket. propagate_playoff_result is a no-op once bracket_propagations
      // holds this result_version, so re-running it on every replay is safe.
      const pm = prior as Match;
      const propagated = await propagateAfterCommit(pm, "result replay");
      return ok(
        propagated
          ? { match: toMatchDTO(pm), replay: true }
          : { match: toMatchDTO(pm), replay: true, propagated: false },
      );
    }
    if (m.status === "done") return fail(409, "kamp_ferdig");
  }

  if (t.status === "finished") return fail(409, "turnering_avsluttet");
  // The bracket was seeded from the table; a late league result would quietly
  // change it. (The organiser can still override.)
  if (m.phase === "league" && t.status === "playoff")
    return fail(409, "serien_avsluttet");

  // Validate against the active profile, then canonicalise (recompute sets).
  // A knockout match must crown a winner: a level score needs a decider, and
  // an abandoned (voided) result would leave the bracket unresolved.
  const knockout = m.phase === "playoff";
  const err = validateResult(t.scoring.profile, body.result, t.scoring, { knockout });
  if (err) return fail(422, "ugyldig_resultat", { detail: err });
  const result = canonicaliseResult(t.scoring.profile, body.result, { knockout });
  if (knockout && isVoid(result))
    return fail(422, "ugyldig_resultat", {
      detail: "Sluttspillkamper må kåre en vinner.",
    });
  const { winner } = resolve(t.scoring.profile, result, t.scoring);
  const winnerTeamId =
    winner === "home" ? m.home_team_id : winner === "away" ? m.away_team_id : null;

  // `<ownerTag>|<name>`: the tag (HMAC of the phone's secret) is what lets this
  // phone — and only this phone — use «Endre» later. No raw deviceId is stored.
  const resultBy = await resultByFor(body.deviceSecret, body.deviceName);

  // Atomic guarded write.
  const { data, error } = await db().rpc("submit_match_result", {
    p_match_id: m.id,
    p_expected_version: body.expectedVersion,
    p_result: result,
    p_winner_team_id: winnerTeamId,
    p_status: "done",
    p_result_by: resultBy,
    ...(requestId ? { p_request_id: requestId } : {}),
  });

  if (error) {
    if (error.message?.includes("version_conflict"))
      return fail(409, "konflikt");
    // The id belongs to another match (migration 0019): a 409 makes the
    // referee outbox drop the entry instead of retrying it forever.
    if (error.message?.includes("request_id_conflict"))
      return fail(409, "foresporsel_konflikt");
    console.error("[result]", error);
    return fail(500, "kunne_ikke_lagre");
  }

  const saved = (Array.isArray(data) ? data[0] : data) ?? (await getMatch(m.id));

  // Playoff: push the winner into the next bracket slot (may finish the cup).
  // The RPC has already committed: a failure here must NOT surface as 5xx, or
  // the referee retries, gets 409 kamp_ferdig and sees a false "konflikt".
  // Report the result as saved and flag the bracket for the organiser.
  // One retry inside (the RPC is idempotent); still failing → the response says
  // so and the referee is told to alert the organiser.
  const propagated = await propagateAfterCommit(saved, "result");

  defer(() => broadcast(channels.tournament(m.tournament_id), events.matchUpdated, {
    matchId: m.id,
  }), "result");
  const out = saved ? toMatchDTO(saved) : saved;
  return ok(propagated ? { match: out } : { match: out, propagated: false });
}

export const POST = withApi(handlePOST);
