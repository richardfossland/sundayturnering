import "server-only";

import { db, getMatches, getTeams, bumpVersion } from "@/lib/server/store";
import { buildCupMatches } from "@/lib/server/build";
import { computeStandings, computeGroupStandings } from "@/lib/tournament/standings";
import { seedKnockoutFromGroups } from "@/lib/tournament/groups";
import { planDownstreamReset } from "@/lib/tournament/downstream";
import type { Match, Tournament } from "@/lib/types";

/** League/group → playoff transition (spec §7). Seed the knockout from the final
 * standings (top-N league, or top-K of each group), build the bracket, flip
 * status to 'playoff'. */
export async function advanceToPlayoff(t: Tournament): Promise<void> {
  const isGroup = t.format === "group_playoff";
  const size = t.config?.playoffSize ?? 0;
  if (!isGroup && size < 2) throw new Error("Sluttspill er ikke konfigurert.");

  // Atomically claim the transition: only one caller can move league→playoff.
  // A second concurrent "advance" finds status already changed and bails, so we
  // never build the bracket twice.
  const { data: claimed } = await db()
    .from("tournaments")
    .update({ status: "playoff" })
    .eq("id", t.id)
    .eq("status", "league")
    .select("id");
  if (!claimed || claimed.length === 0)
    throw new Error("Sluttspillet er allerede startet.");

  try {
    const [teams, matches] = await Promise.all([getTeams(t.id), getMatches(t.id)]);

    let seedIds: string[];
    if (isGroup) {
      const perGroup = t.config?.advancePerGroup ?? 2;
      const groups = computeGroupStandings(teams, matches, t.scoring, perGroup);
      const qualifiers = groups.map((g) =>
        g.rows.slice(0, perGroup).map((r) => r.team_id),
      );
      seedIds = seedKnockoutFromGroups(qualifiers);
    } else {
      const standings = computeStandings(teams, matches, t.scoring, size);
      seedIds = standings.slice(0, size).map((s) => s.team_id);
    }
    if (seedIds.length < 2) throw new Error("For få lag til sluttspill.");

    // Reuse the cup builder; courts carry over for parallel mode.
    const courtIds = (
      await db().from("courts").select("id,sort_order").eq("tournament_id", t.id)
    ).data
      ?.sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => c.id as string);

    await buildCupMatches(t.id, seedIds, courtIds ?? [], {
      thirdPlace: t.config?.thirdPlace,
    });
    await bumpVersion(t.id);
  } catch (e) {
    // Build failed after claiming → revert the claim + remove any partial
    // playoff rows (bracket_links cascade with their matches).
    await db()
      .from("matches")
      .delete()
      .eq("tournament_id", t.id)
      .eq("phase", "playoff");
    await db().from("tournaments").update({ status: "league" }).eq("id", t.id);
    throw e;
  }
}

/** Un-finish a tournament so a result can be corrected after the champion
 * screen showed. The prior phase is "playoff" if a knockout was ever built,
 * otherwise "league". Guarded on status so a concurrent reopen is a no-op.
 * Returns the status it went back to. */
export async function reopenTournament(t: Tournament): Promise<"league" | "playoff"> {
  const matches = await getMatches(t.id);
  const priorStatus = matches.some((m) => m.phase === "playoff") ? "playoff" : "league";
  await db()
    .from("tournaments")
    .update({ status: priorStatus })
    .eq("id", t.id)
    .eq("status", "finished");
  await bumpVersion(t.id);
  return priorStatus;
}

/** A knockout result whose WINNER changes after later rounds were played:
 * every later match that already started goes back to 'scheduled' with its
 * result cleared, and the slots those matches fed are blanked, so propagation
 * can re-flow the new winner (and bronze loser). A finished tournament returns
 * to 'playoff'. With `dryRun` nothing is written. Returns how many matches
 * are (or would be) reset. Organiser-only — the caller confirms first. */
export async function resetDownstream(
  t: Tournament,
  matchId: string,
  opts: { dryRun?: boolean } = {},
): Promise<number> {
  const sb = db();
  const [{ data: links }, matches] = await Promise.all([
    sb
      .from("bracket_links")
      .select("from_match_id,to_match_id,to_slot")
      .eq("tournament_id", t.id),
    getMatches(t.id),
  ]);
  const plan = planDownstreamReset(matchId, links ?? [], matches);
  if (opts.dryRun || plan.reset.length === 0) return plan.reset.length;

  for (const id of plan.reset) {
    const m = matches.find((x) => x.id === id);
    if (!m) continue;
    const { error } = await sb
      .from("matches")
      .update({
        status: "scheduled",
        result: null,
        winner_team_id: null,
        result_version: m.result_version + 1,
        locked_by: null,
        result_by: null,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  for (const s of plan.clearSlots) {
    const col = s.slot === "home" ? "home_team_id" : "away_team_id";
    const { error } = await sb.from("matches").update({ [col]: null }).eq("id", s.matchId);
    if (error) throw new Error(error.message);
  }
  if (t.status === "finished")
    await sb.from("tournaments").update({ status: "playoff" }).eq("id", t.id);
  return plan.reset.length;
}

/** After a playoff match resolves, push the winner into the next match's slot
 * (and, for a bronze final, the loser into its loser-link) via bracket_links.
 * The tournament finishes only when the FINAL (bracket_slot 0, no winner-link)
 * completes — never when a bronze final does. Returns whether it finished.
 *
 * The whole step runs as ONE atomic, idempotent Postgres RPC
 * (`propagate_playoff_result`, migration 0009) instead of the several
 * separate client-side writes this used to be: a crash/timeout partway
 * through can no longer leave the bracket half-updated, and calling this
 * twice for the SAME result (retry, double-tap, two referee devices) is a
 * guaranteed no-op the second time — the RPC checks a guard row keyed on
 * (match_id, result_version) before writing anything. Calling it again after
 * a genuine correction (organiser override bumps result_version) still
 * re-propagates, which is the desired "fix the mistake downstream too"
 * behaviour.
 *
 * Falls back to the pre-migration multi-write path when the RPC hasn't been
 * deployed yet (PostgREST error PGRST202 = function not in the schema cache),
 * so this file tolerates either deploy order — see docs/DEPLOY.md. Once
 * migration 0009 is confirmed live everywhere, the fallback is dead code and
 * may be deleted in a follow-up. */
export async function propagateResult(match: Match): Promise<boolean> {
  if (match.phase !== "playoff" || !match.winner_team_id) return false;
  const sb = db();

  const { data, error } = await sb.rpc("propagate_playoff_result", {
    p_match_id: match.id,
  });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return Boolean(row?.finished);
  }
  if (error.code !== "PGRST202") {
    console.error("[propagateResult]", error);
    throw error;
  }
  return propagateResultLegacy(match);
}

/** Pre-migration-0009 propagation: several separate writes, kept only as a
 * fallback for the window between deploying this code and running the
 * migration (see propagateResult above). Not transactional and not guarded
 * against duplicate calls — do not call directly. */
async function propagateResultLegacy(match: Match): Promise<boolean> {
  const sb = db();

  const { data: rawLinks } = await sb
    .from("bracket_links")
    .select("*")
    .eq("from_match_id", match.id);
  const links = rawLinks ?? [];
  const winnerLinks = links.filter((l) => l.feed !== "loser"); // default 'winner'
  const loserLinks = links.filter((l) => l.feed === "loser");

  // Bronze final: push the loser of this match into its loser-link slot.
  if (loserLinks.length > 0) {
    const loserId =
      match.home_team_id === match.winner_team_id
        ? match.away_team_id
        : match.home_team_id;
    if (loserId) {
      for (const link of loserLinks) {
        const col = link.to_slot === "home" ? "home_team_id" : "away_team_id";
        await sb
          .from("matches")
          .update({ [col]: loserId })
          .eq("id", link.to_match_id);
      }
    }
  }

  if (winnerLinks.length === 0) {
    // No onward winner-link. The final (slot 0) finishes the tournament; a
    // bronze final (slot 1) just records third place.
    const isFinal = match.bracket_slot === 0;
    if (isFinal)
      await sb
        .from("tournaments")
        .update({ status: "finished" })
        .eq("id", match.tournament_id);
    await bumpVersion(match.tournament_id);
    return isFinal;
  }

  for (const link of winnerLinks) {
    const col = link.to_slot === "home" ? "home_team_id" : "away_team_id";
    await sb
      .from("matches")
      .update({ [col]: match.winner_team_id })
      .eq("id", link.to_match_id);
  }
  await bumpVersion(match.tournament_id);
  return false;
}
