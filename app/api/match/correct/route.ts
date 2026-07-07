import { ok, fail, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { db, getMatch, getTournament } from "@/lib/server/store";
import { propagateResult } from "@/lib/server/playoff";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import {
  validateResult,
  canonicaliseResult,
  resolve,
  isVoid,
} from "@/lib/tournament/scoring";
import { canSelfCorrect } from "@/lib/tournament/correct";

// POST /api/match/correct — a referee fixes THEIR OWN just-saved result within a
// short grace window, WITHOUT the organiser code. Self-authorising: the server
// checks the saving device (result_by) + the time window (updated_at). The
// optimistic version guard is preserved via the same RPC the result route uses.
export async function POST(req: Request) {
  if (!rateLimit(`match-correct:${clientIp(req)}`, 60, 60_000))
    return fail(429, "for_mange_forsok");
  const body = await readJson<{
    matchId?: string;
    expectedVersion?: number;
    result?: Record<string, unknown>;
    deviceId?: string;
    deviceName?: string;
  }>(req);
  if (
    !body?.matchId ||
    typeof body.expectedVersion !== "number" ||
    !body.result ||
    !body.deviceId
  )
    return fail(400, "mangler_felt");

  const m = await getMatch(body.matchId);
  if (!m) return fail(404, "finnes_ikke");
  if (m.status !== "done") return fail(409, "ikke_ferdig");
  if (!m.result_by || m.result_by.split("|")[0] !== body.deviceId)
    return fail(403, "ikke_din_kamp");
  if (!canSelfCorrect(m, body.deviceId, Date.now())) return fail(409, "for_sent");
  if (!m.home_team_id || !m.away_team_id) return fail(409, "kamp_ikke_klar");

  const t = await getTournament(m.tournament_id);
  if (!t) return fail(404, "finnes_ikke");

  const err = validateResult(t.scoring.profile, body.result, t.scoring);
  if (err) return fail(422, "ugyldig_resultat", { detail: err });
  const result = canonicaliseResult(t.scoring.profile, body.result);
  if (m.phase === "playoff" && isVoid(result))
    return fail(422, "ugyldig_resultat", {
      detail: "Sluttspillkamper må kåre en vinner.",
    });
  const { winner } = resolve(t.scoring.profile, result, t.scoring);
  const winnerTeamId =
    winner === "home" ? m.home_team_id : winner === "away" ? m.away_team_id : null;

  const resultBy = body.deviceName
    ? `${body.deviceId}|${body.deviceName}`
    : body.deviceId;

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
  if (saved?.phase === "playoff") await propagateResult(saved);

  await broadcast(channels.tournament(m.tournament_id), events.matchUpdated, {
    matchId: m.id,
  });
  return ok({ match: saved });
}
