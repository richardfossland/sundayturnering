import { ok, fail, readJson, rateLimit, ipKey, withApi } from "@/lib/server/http";
import { db, getMatch, getMatches, getTournament } from "@/lib/server/store";
import { resetDownstream } from "@/lib/server/playoff";
import { propagateAfterCommit } from "@/lib/server/propagate";
import { ownsResult, resultByFor } from "@/lib/server/pair";
import { toMatchDTO } from "@/lib/dto";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import {
  validateResult,
  canonicaliseResult,
  resolve,
  isVoid,
} from "@/lib/tournament/scoring";
import { correctBlock, inSelfCorrectWindow } from "@/lib/tournament/correct";
import { checkControlCode, prefetchBlocked } from "@/lib/server/auth";

// POST /api/match/correct — a referee fixes THEIR OWN just-saved result within a
// short grace window, WITHOUT the organiser code. Self-authorising: the server
// checks the saving device (result_by = HMAC of the phone's private deviceSecret,
// never the public device id) + the time window (updated_at). The same guards
// as the plain result route apply (serie over, tournament finished — except the
// deciding final, whose save is what finished it — and Swiss rounds already
// followed by a later round). The optimistic version guard is preserved via the
// same RPC the result route uses.
async function handlePOST(req: Request) {
  if (!rateLimit(`match-correct:${ipKey(req)}`, 600, 60_000))
    return fail(429, "for_mange_forsok");
  const body = await readJson<{
    matchId?: string;
    expectedVersion?: number;
    result?: Record<string, unknown>;
    deviceName?: string;
    /** The saving phone's private secret (see lib/server/pair.ts). */
    deviceSecret?: string;
    controlCode?: string;
  }>(req);
  if (!body?.matchId || typeof body.expectedVersion !== "number" || !body.result)
    return fail(400, "mangler_felt");

  const m = await getMatch(body.matchId);
  if (!m) return fail(404, "finnes_ikke");
  if (m.status !== "done") return fail(409, "ikke_ferdig");
  // Ownership: only the phone that knows the secret behind result_by. Results
  // saved before this scheme (raw device id) or by a client without a secret
  // can only be changed by the organiser.
  if (!(await ownsResult(m.result_by, body.deviceSecret))) return fail(403, "ikke_din_kamp");
  if (!inSelfCorrectWindow(m, Date.now())) return fail(409, "for_sent");
  if (!m.home_team_id || !m.away_team_id) return fail(409, "kamp_ikke_klar");

  const blocked = prefetchBlocked(req, m.tournament_id);
  const t = await getTournament(m.tournament_id).catch((e) => {
    blocked?.catch(() => {});
    throw e;
  });
  if (!t) return fail(404, "finnes_ikke");
  if (!(await checkControlCode(req, t, body.controlCode, blocked))) return fail(403, "feil_kontrollkode");
  // Same sperrer as «Lagre», so a corrected result cannot quietly change what a
  // later phase was built from. The deciding final is the exception: saving it
  // finished the tournament, and its referee still has the grace window.
  // (propagate_playoff_result re-flows the winner and keeps the status right.)
  // (The sibling matches are only needed to recognise the final / the Swiss round.)
  const siblings = t.status === "finished" || t.format === "swiss" ? await getMatches(t.id) : [];
  const block = correctBlock(t, m, siblings);
  if (block === "runde_spilt")
    return fail(409, "runde_spilt", {
      detail: "En senere runde er allerede satt opp. Be arrangøren endre resultatet.",
    });
  if (block) return fail(409, block);

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
  // A referee may not rewrite the bracket under a match that already started;
  // that takes the organiser (override + confirm).
  if (
    knockout &&
    winnerTeamId !== m.winner_team_id &&
    (await resetDownstream(t, m.id, { dryRun: true })) > 0
  )
    return fail(409, "neste_kamp_spilt", {
      detail: "Neste sluttspillkamp har allerede startet. Be arrangøren endre resultatet.",
    });

  // Same owner tag as before (the secret is unchanged), the name may be updated.
  const resultBy = await resultByFor(body.deviceSecret, body.deviceName);

  const { data, error } = await db().rpc("submit_match_result", {
    p_match_id: m.id,
    p_expected_version: body.expectedVersion,
    p_result: result,
    p_winner_team_id: winnerTeamId,
    p_status: "done",
    p_result_by: resultBy,
  });

  if (error) {
    if (error.message?.includes("version_conflict")) return fail(409, "konflikt");
    console.error("[correct]", error);
    return fail(500, "kunne_ikke_lagre");
  }

  const saved = (Array.isArray(data) ? data[0] : data) ?? (await getMatch(m.id));
  // Playoff: re-flow the (possibly changed) winner into the next bracket slot.
  // Already committed: a propagate failure must not read as a failed save.
  const propagated = await propagateAfterCommit(saved, "correct");

  defer(() => broadcast(channels.tournament(m.tournament_id), events.matchUpdated, {
    matchId: m.id,
  }), "correct");
  const out = saved ? toMatchDTO(saved) : saved;
  return ok(propagated ? { match: out } : { match: out, propagated: false });
}

export const POST = withApi(handlePOST);
