import { ok, fail, readJson, organiserLimit, must, withApi } from "@/lib/server/http";
import { authOrganiserOrAdmin } from "@/lib/server/auth";
import { db, getMatch } from "@/lib/server/store";
import { resetDownstream } from "@/lib/server/playoff";
import type { Match } from "@/lib/types";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import {
  validateResult,
  canonicaliseResult,
  resolve,
  isVoid,
} from "@/lib/tournament/scoring";

// POST /api/organiser/override — force-set any match result (spec §5). Bypasses
// the version guard (organiser authority), but still validates the result shape
// and re-propagates the bracket. Authorised by EITHER the organiser code OR a
// signed-in admin who owns it.
//
// Knockout: if the WINNER changes and later matches it fed were already
// played, the first call answers 409 `neste_kamp_spilt` with the count; the
// organiser confirms and resends with `cascade: true`, which resets those
// matches (resetDownstream) before the new winner is propagated.
async function handlePOST(req: Request) {
  const limited = organiserLimit(req);
  if (limited) return limited;
  const body = await readJson<{
    tournamentId?: string;
    organiserCode?: string;
    matchId?: string;
    result?: Record<string, unknown>;
    cascade?: boolean;
  }>(req);
  const t = await authOrganiserOrAdmin(body?.tournamentId, body?.organiserCode, req);
  if (!t) return fail(403, "feil_arrangorkode");
  if (!body?.matchId || !body.result) return fail(400, "mangler_felt");

  const m = await getMatch(body.matchId);
  if (!m || m.tournament_id !== t.id) return fail(404, "finnes_ikke");
  if (!m.home_team_id || !m.away_team_id) return fail(409, "kamp_ikke_klar");

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

  if (knockout && m.status === "done" && winnerTeamId !== m.winner_team_id) {
    const played = await resetDownstream(t, m.id, { dryRun: true });
    if (played > 0 && body.cascade !== true)
      return fail(409, "neste_kamp_spilt", {
        count: played,
        detail: `Ny vinner betyr at ${played} senere sluttspillkamp${played === 1 ? "" : "er"} som allerede er spilt, nullstilles.`,
      });
  }

  // ONE transaction (migration 0010): row lock → reset downstream matches (if
  // the winner of a played knockout match changed; the 409 above already made
  // the organiser confirm) → write result with result_version+1 → propagate
  // through the bracket → bump the tournament version.
  const resetDown = knockout && m.status === "done" && winnerTeamId !== m.winner_team_id;
  const rpc = await db().rpc("override_match_result", {
    p_match_id: m.id,
    p_result: result,
    p_winner_team_id: winnerTeamId,
    p_reset_downstream: resetDown,
  });
  if (rpc.error?.code === "P0002") return fail(404, "finnes_ikke");
  const saved = must(rpc) as Match;

  defer(() => broadcast(channels.tournament(t.id), events.matchUpdated, {
    matchId: m.id,
  }), "override");
  return ok({ match: saved });
}

export const POST = withApi(handlePOST);
