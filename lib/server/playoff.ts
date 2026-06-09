import "server-only";

import { db, getMatches, getTeams, bumpVersion } from "@/lib/server/store";
import { buildCupMatches } from "@/lib/server/build";
import { computeStandings } from "@/lib/tournament/standings";
import type { Match, Tournament } from "@/lib/types";

/** League → playoff transition (spec §7). Seed the top-N from the final
 * standings, build the bracket, flip status to 'playoff'. */
export async function advanceToPlayoff(t: Tournament): Promise<void> {
  const [teams, matches] = await Promise.all([getTeams(t.id), getMatches(t.id)]);
  const size = t.config?.playoffSize ?? 0;
  if (size < 2) throw new Error("Sluttspill er ikke konfigurert.");

  const standings = computeStandings(teams, matches, t.scoring, size);
  const topIds = standings.slice(0, size).map((s) => s.team_id);
  if (topIds.length < 2) throw new Error("For få lag til sluttspill.");

  // Reuse the cup builder; courts carry over for parallel mode.
  const courtIds = (
    await db().from("courts").select("id,sort_order").eq("tournament_id", t.id)
  ).data
    ?.sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => c.id as string);

  await buildCupMatches(t.id, topIds, courtIds ?? []);
  await db().from("tournaments").update({ status: "playoff" }).eq("id", t.id);
  await bumpVersion(t.id);
}

/** After a playoff match resolves, push the winner into the next match's slot
 * via bracket_links. If the match has no outgoing link it was the final →
 * the tournament is finished. Returns whether the tournament finished. */
export async function propagateWinner(match: Match): Promise<boolean> {
  if (match.phase !== "playoff" || !match.winner_team_id) return false;
  const sb = db();

  const { data: links } = await sb
    .from("bracket_links")
    .select("*")
    .eq("from_match_id", match.id);

  if (!links || links.length === 0) {
    // No onward link → this was the final.
    await sb
      .from("tournaments")
      .update({ status: "finished" })
      .eq("id", match.tournament_id);
    await bumpVersion(match.tournament_id);
    return true;
  }

  for (const link of links) {
    const col = link.to_slot === "home" ? "home_team_id" : "away_team_id";
    await sb
      .from("matches")
      .update({ [col]: match.winner_team_id })
      .eq("id", link.to_match_id);
  }
  await bumpVersion(match.tournament_id);
  return false;
}
