import "server-only";

import { db, getMatches, getTeams, bumpVersion } from "@/lib/server/store";
import { buildCupMatches } from "@/lib/server/build";
import { computeStandings, computeGroupStandings } from "@/lib/tournament/standings";
import { seedKnockoutFromGroups } from "@/lib/tournament/groups";
import { bSeedsFromGroups, bSeedsFromLeague, pendingFinals } from "@/lib/tournament/consolation";
import { grandFinalAction } from "@/lib/tournament/doubleElim";
import { planDownstreamReset } from "@/lib/tournament/downstream";
import { phaseCarryOver } from "@/lib/tournament/schedule";
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
    // B-sluttspill for resten: lagene som ikke kom til A, seedet etter samme tabell.
    let bSeeds: string[] | undefined;
    const wantB = t.config?.consolation === "b_playoff";
    if (isGroup) {
      const perGroup = t.config?.advancePerGroup ?? 2;
      const groups = computeGroupStandings(teams, matches, t.scoring, perGroup, t.config?.tiebreak);
      const qualifiers = groups.map((g) =>
        g.rows.slice(0, perGroup).map((r) => r.team_id),
      );
      // Innen hvert nivå seedes lagene etter rekord (poeng per kamp osv.), ikke gruppebokstav.
      const records = new Map(
        groups.flatMap((g) =>
          g.rows.map((r) => [
            r.team_id,
            { played: r.played, points: r.points, diff: r.diff, scored: r.scoreFor },
          ] as const),
        ),
      );
      seedIds = seedKnockoutFromGroups(qualifiers, records);
      if (wantB)
        bSeeds = bSeedsFromGroups(
          groups.map((g) => g.rows.map((r) => r.team_id)),
          perGroup,
          records,
        );
    } else {
      const standings = computeStandings(teams, matches, t.scoring, size, t.config?.tiebreak);
      seedIds = standings.slice(0, size).map((s) => s.team_id);
      if (wantB)
        bSeeds = bSeedsFromLeague(
          standings.map((s) => s.team_id),
          size,
        );
    }
    if (seedIds.length < 2) throw new Error("For få lag til sluttspill.");

    // Reuse the cup builder; courts carry over for parallel mode.
    const courtIds = (
      await db().from("courts").select("id,sort_order").eq("tournament_id", t.id)
    ).data
      ?.sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => c.id as string);

    // Med tidsplan: sluttspillet starter tidligst nå (rundet opp til 5 min) og
    // etter kampene som fortsatt kan spilles. Seriekamper som ikke ble spilt (tidlig
    // start) teller ikke, og ferdige kamper regnes med faktisk slutt. Lagenes siste
    // sluttidspunkt gir hviletid også over fasegrensen. Kamper som venter på et
    // mater-resultat (TBD) får hvilen per mater i planleggeren.
    const schedule = t.config?.schedule;
    let notBefore: Date | undefined;
    let priorEnds: Map<string, number> | undefined;
    if (schedule) {
      const carry = phaseCarryOver(matches, schedule, "playoff", Date.now());
      notBefore = new Date(carry.notBefore);
      priorEnds = carry.teamEnds;
    }
    await buildCupMatches(t.id, seedIds, courtIds ?? [], {
      thirdPlace: t.config?.thirdPlace,
      schedule,
      notBefore,
      priorEnds,
      bSeeds: bSeeds && bSeeds.length >= 2 ? bSeeds : undefined,
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
        called_at: null,
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
 * The tournament finishes only when EVERY bracket final (bracket_slot 0, no
 * winner-link: A, and B when there is one) has completed — never when a bronze
 * final does. Returns whether it finished.
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

  for (const link of winnerLinks) {
    const col = link.to_slot === "home" ? "home_team_id" : "away_team_id";
    await sb
      .from("matches")
      .update({ [col]: match.winner_team_id })
      .eq("id", link.to_match_id);
  }

  // Dobbel utslag: storfinalen avgjør om omkampen utgår (W-laget vant) eller skal
  // spilles (L-laget vant; gjenåpnes hvis den var utgått etter en overstyring).
  let all: Match[] | null = null;
  let voided: string | null = null;
  if (match.bracket === "GF" && match.round === 1) {
    all = await getMatches(match.tournament_id);
    const gf2 = all.find((m) => m.bracket === "GF" && m.round === 2);
    const action = grandFinalAction(match, !!gf2);
    if (gf2 && action === "void") {
      await sb
        .from("matches")
        .update({ status: "bye", winner_team_id: match.winner_team_id, result: null })
        .eq("id", gf2.id);
      voided = gf2.id;
    } else if (gf2 && action === "restore" && gf2.status === "bye") {
      await sb
        .from("matches")
        .update({ status: "scheduled", winner_team_id: null, result: null })
        .eq("id", gf2.id);
      await sb
        .from("tournaments")
        .update({ status: "playoff" })
        .eq("id", match.tournament_id)
        .eq("status", "finished");
    }
  }

  // A bracket final (slot 0, nothing onward) finishes the tournament once no
  // other bracket final is left; a bronze final (slot 1) just records third
  // place. A voided rematch makes the grand final the deciding match.
  const isFinal = (winnerLinks.length === 0 && match.bracket_slot === 0) || voided !== null;
  if (!isFinal) {
    await bumpVersion(match.tournament_id);
    return false;
  }
  const [{ data: allLinks }, current] = await Promise.all([
    sb.from("bracket_links").select("from_match_id,feed").eq("tournament_id", match.tournament_id),
    all ? Promise.resolve(all) : getMatches(match.tournament_id),
  ]);
  const decided =
    pendingFinals(
      current.map((m) =>
        m.id === match.id ? { ...m, status: "done" as const } : m.id === voided ? { ...m, status: "bye" as const } : m,
      ),
      allLinks ?? [],
    ).length === 0;
  if (decided)
    await sb.from("tournaments").update({ status: "finished" }).eq("id", match.tournament_id);
  await bumpVersion(match.tournament_id);
  return decided;
}
