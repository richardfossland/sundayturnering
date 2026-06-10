import { ok, fail, readJson } from "@/lib/server/http";
import { db, getMatch, getTournament } from "@/lib/server/store";
import { propagateWinner } from "@/lib/server/playoff";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import {
  validateResult,
  canonicaliseResult,
  resolve,
} from "@/lib/tournament/scoring";

// POST /api/match/result — submit a result with optimistic concurrency (spec
// §4.2). The control device sends the result_version it based the edit on; the
// RPC accepts only if it still matches, then bumps it. Loser → 409 conflict.
export async function POST(req: Request) {
  const body = await readJson<{
    matchId?: string;
    expectedVersion?: number;
    result?: Record<string, unknown>;
  }>(req);
  if (!body?.matchId || typeof body.expectedVersion !== "number" || !body.result)
    return fail(400, "mangler_felt");

  const m = await getMatch(body.matchId);
  if (!m) return fail(404, "finnes_ikke");
  if (m.status === "bye") return fail(409, "kan_ikke_endre_bye");
  // A finished match is edited via the organiser override (which re-propagates
  // the bracket); the plain result route must not overwrite/re-propagate it.
  if (m.status === "done") return fail(409, "kamp_ferdig");
  if (!m.home_team_id || !m.away_team_id) return fail(409, "kamp_ikke_klar");

  const t = await getTournament(m.tournament_id);
  if (!t) return fail(404, "finnes_ikke");

  // Validate against the active profile, then canonicalise (recompute sets).
  const err = validateResult(t.scoring.profile, body.result, t.scoring);
  if (err) return fail(422, "ugyldig_resultat", { detail: err });
  const result = canonicaliseResult(t.scoring.profile, body.result);
  const { winner } = resolve(t.scoring.profile, result);
  const winnerTeamId =
    winner === "home" ? m.home_team_id : winner === "away" ? m.away_team_id : null;

  // Atomic guarded write.
  const { data, error } = await db().rpc("submit_match_result", {
    p_match_id: m.id,
    p_expected_version: body.expectedVersion,
    p_result: result,
    p_winner_team_id: winnerTeamId,
    p_status: "done",
  });

  if (error) {
    if (error.message?.includes("version_conflict"))
      return fail(409, "konflikt");
    console.error("[result]", error);
    return fail(500, "kunne_ikke_lagre");
  }

  const saved = (Array.isArray(data) ? data[0] : data) ?? (await getMatch(m.id));

  // Playoff: push the winner into the next bracket slot (may finish the cup).
  if (saved?.phase === "playoff") await propagateWinner(saved);

  await broadcast(channels.tournament(m.tournament_id), events.matchUpdated, {
    matchId: m.id,
  });
  return ok({ match: saved });
}
