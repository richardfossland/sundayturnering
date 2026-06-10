// Small pure view helpers shared by board + control.
import type { Match, Team } from "@/lib/types";
import type { StateDTO } from "@/lib/dto";
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
    const final = playoff.find((m) => m.round === finalRound && m.status === "done");
    if (final?.winner_team_id) return final.winner_team_id;
  }
  if (state.standings.length > 0 && state.standings.some((s) => s.played > 0))
    return state.standings[0].team_id;
  return null;
}

/** Final ranking of all teams for the results/diploma page. Uses league
 * standings when meaningful (champion floated to top), else cup round reached. */
export function finalRanking(state: StateDTO): Team[] {
  const { teams, standings, matches } = state;
  const byId = new Map(teams.map((t) => [t.id, t]));
  const champ = championId(state);

  if (standings.length > 0 && standings.some((s) => s.played > 0)) {
    let order = standings
      .map((s) => byId.get(s.team_id))
      .filter((t): t is Team => !!t);
    if (champ)
      order = [byId.get(champ)!, ...order.filter((t) => t.id !== champ)];
    return order;
  }

  // Pure cup: later elimination round = better placement; champion first.
  const playoff = matches.filter((m) => m.phase === "playoff");
  const lostRound = new Map<string, number>();
  for (const m of playoff) {
    if (m.status !== "done" || !m.winner_team_id) continue;
    for (const tid of [m.home_team_id, m.away_team_id]) {
      if (tid && tid !== m.winner_team_id)
        lostRound.set(tid, Math.max(lostRound.get(tid) ?? 0, m.round));
    }
  }
  return [...teams].sort((a, b) => {
    if (a.id === champ) return -1;
    if (b.id === champ) return 1;
    const ra = lostRound.get(a.id) ?? 0;
    const rb = lostRound.get(b.id) ?? 0;
    if (rb !== ra) return rb - ra;
    return (a.seed ?? 99) - (b.seed ?? 99);
  });
}
