// Small pure view helpers shared by board + control.
import type { Match, Team } from "@/lib/types";
import type { StateDTO } from "@/lib/dto";
import { BRONZE_SLOT } from "@/lib/tournament/bracket";
import { no } from "@/lib/locale/no";

export function teamMap(teams: Team[]): Map<string, Team> {
  return new Map(teams.map((t) => [t.id, t]));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Bracket round label given how many playoff rounds there are. */
export function bracketRoundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round; // 0 = final
  if (fromEnd === 0) return no.board.final;
  if (fromEnd === 1) return no.board.semifinal;
  if (fromEnd === 2) return no.board.quarterfinal;
  return `${no.board.round} ${round}`;
}

/** Matches that are live right now (board "now playing"). */
export function liveMatches(matches: Match[]): Match[] {
  return matches.filter((m) => m.status === "live");
}

/** The next scheduled matches in queue order (board "next up"). */
export function upcoming(matches: Match[], limit = 5): Match[] {
  return matches
    .filter((m) => m.status === "scheduled" && m.home_team_id && m.away_team_id)
    .sort((a, b) => a.queue_order - b.queue_order)
    .slice(0, limit);
}

/** The champion's team id: playoff final winner if a bracket exists, else the
 * rank-1 league standing. Null until decided. */
export function championId(state: StateDTO): string | null {
  const playoff = state.matches.filter((m) => m.phase === "playoff");
  if (playoff.length > 0) {
    const finalRound = Math.max(...playoff.map((m) => m.round));
    // The final is at bracket_slot 0; the bronze final (slot 1) shares the round
    // but never crowns the champion.
    const final = playoff.find(
      (m) =>
        m.round === finalRound &&
        m.bracket_slot === 0 &&
        m.status === "done",
    );
    if (final?.winner_team_id) return final.winner_team_id;
  }
  if (state.standings.length > 0 && state.standings.some((s) => s.played > 0))
    return state.standings[0].team_id;
  return null;
}

/** The decided knockout podium, in order: champion, final loser, bronze winner,
 * bronze loser. Only teams whose place is actually settled appear — and nothing
 * at all until the FINAL is done, so a bronze final played before the final can
 * never put its winner on top. */
export function knockoutPodium(playoff: Match[]): string[] {
  if (playoff.length === 0) return [];
  const finalRound = Math.max(...playoff.map((m) => m.round));
  const otherSide = (m: Match) =>
    m.home_team_id === m.winner_team_id ? m.away_team_id : m.home_team_id;
  const final = playoff.find(
    (m) => m.round === finalRound && m.bracket_slot === 0 && m.status === "done",
  );
  if (!final?.winner_team_id) return [];
  const podium: (string | null)[] = [final.winner_team_id, otherSide(final)];
  const bronze = playoff.find(
    (m) =>
      m.round === finalRound &&
      m.bracket_slot === BRONZE_SLOT &&
      m.status === "done",
  );
  if (bronze?.winner_team_id) podium.push(bronze.winner_team_id, otherSide(bronze));
  const seen = new Set<string>();
  return podium.filter((id): id is string => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Final ranking of all teams for the results/diploma page.
 *
 * With a knockout (cup, liga + sluttspill, gruppespill) the decided podium
 * comes first — champion, final loser, bronze winner, bronze loser — because
 * that is what the bracket settled. The league table is NOT the podium: in a
 * liga + sluttspill the team that topped the table but lost the final is the
 * runner-up, not "2nd because it was 1st in the league" — and vice versa.
 * Everyone else is ordered by the league table when there is one (the phase
 * they were eliminated in), else by how far they got in the cup (later loss =
 * better), then seed. */
export function finalRanking(state: StateDTO): Team[] {
  const { teams, standings, matches } = state;
  const playoff = matches.filter((m) => m.phase === "playoff");
  const hasStandings =
    standings.length > 0 && standings.some((s) => s.played > 0);

  const podium = knockoutPodium(playoff);
  const podiumRank = new Map(podium.map((id, i) => [id, i]));

  // League table position (rank order) as the fallback for everyone else.
  const tableRank = new Map<string, number>();
  if (hasStandings) standings.forEach((s, i) => tableRank.set(s.team_id, i));

  // Cup-only fallback: the round a team was eliminated in (higher = better).
  const finalRound = playoff.length ? Math.max(...playoff.map((m) => m.round)) : 0;
  const lostRound = new Map<string, number>();
  for (const m of playoff) {
    if (m.status !== "done" || !m.winner_team_id) continue;
    if (m.round === finalRound && m.bracket_slot === BRONZE_SLOT) continue;
    for (const tid of [m.home_team_id, m.away_team_id]) {
      if (tid && tid !== m.winner_team_id)
        lostRound.set(tid, Math.max(lostRound.get(tid) ?? 0, m.round));
    }
  }

  // League without a knockout: the table IS the ranking (champion = rank 1).
  const champ = podium[0] ?? (hasStandings ? championId(state) : null);

  return [...teams].sort((a, b) => {
    const pa = podiumRank.get(a.id) ?? (a.id === champ ? 0 : 99);
    const pb = podiumRank.get(b.id) ?? (b.id === champ ? 0 : 99);
    if (pa !== pb) return pa - pb;
    if (hasStandings) {
      const ta = tableRank.get(a.id) ?? 999;
      const tb = tableRank.get(b.id) ?? 999;
      if (ta !== tb) return ta - tb;
    }
    const ra = lostRound.get(a.id) ?? 0;
    const rb = lostRound.get(b.id) ?? 0;
    if (rb !== ra) return rb - ra;
    return (a.seed ?? 99) - (b.seed ?? 99);
  });
}
