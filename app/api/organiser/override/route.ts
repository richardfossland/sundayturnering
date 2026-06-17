import { ok, fail, readJson } from "@/lib/server/http";
import { authOrganiser } from "@/lib/server/auth";
import { db, getMatch } from "@/lib/server/store";
import { propagateResult } from "@/lib/server/playoff";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import {
  validateResult,
  canonicaliseResult,
  resolve,
} from "@/lib/tournament/scoring";

// POST /api/organiser/override — force-set any match result (spec §5). Bypasses
// the version guard (organiser authority), but still validates the result shape
// and re-propagates the bracket. Organiser-code gated.
export async function POST(req: Request) {
  const body = await readJson<{
    tournamentId?: string;
    organiserCode?: string;
    matchId?: string;
    result?: Record<string, unknown>;
  }>(req);
  const t = await authOrganiser(body?.tournamentId, body?.organiserCode);
  if (!t) return fail(403, "feil_arrangorkode");
  if (!body?.matchId || !body.result) return fail(400, "mangler_felt");

  const m = await getMatch(body.matchId);
  if (!m || m.tournament_id !== t.id) return fail(404, "finnes_ikke");
  if (!m.home_team_id || !m.away_team_id) return fail(409, "kamp_ikke_klar");

  const err = validateResult(t.scoring.profile, body.result, t.scoring);
  if (err) return fail(422, "ugyldig_resultat", { detail: err });
  const result = canonicaliseResult(t.scoring.profile, body.result);
  const { winner } = resolve(t.scoring.profile, result, t.scoring);
  const winnerTeamId =
    winner === "home" ? m.home_team_id : winner === "away" ? m.away_team_id : null;

  await db()
    .from("matches")
    .update({
      result,
      winner_team_id: winnerTeamId,
      status: "done",
      result_version: m.result_version + 1,
      locked_by: null,
      result_by: null, // organiser correction is not a referee self-save
    })
    .eq("id", m.id);

  const saved = await getMatch(m.id);
  if (saved?.phase === "playoff") await propagateResult(saved);

  await broadcast(channels.tournament(t.id), events.matchUpdated, {
    matchId: m.id,
  });
  return ok({ match: saved });
}
