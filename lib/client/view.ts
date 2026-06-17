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

  // Pure cup: champion 1st, final loser 2nd, then bronze final (3rd/4th) if
  // played, then everyone else by how far they got (later loss = better).
  const playoff = matches.filter((m) => m.phase === "playoff");
  const finalRound = playoff.length
    ? Math.max(...playoff.map((m) => m.round))
    : 0;
  const otherSide = (m: Match) =>
    m.home_team_id === m.winner_team_id ? m.away_team_id : m.home_team_id;

  const final = playoff.find(
    (m) => m.round === finalRound && m.bracket_slot === 0 && m.status === "done",
  );
  const finalLoser = final ? otherSide(final) : null;
  const bronze = playoff.find(
    (m) =>
      m.round === finalRound &&
      m.bracket_slot === BRONZE_SLOT &&
      m.status === "done",
  );
  const bronzeWinner = bronze?.winner_team_id ?? null;
  const bronzeLoser = bronze ? otherSide(bronze) : null;

  const lostRound = new Map<string, number>();
  for (const m of playoff) {
    if (m.status !== "done" || !m.winner_team_id) continue;
    if (m.round === finalRound && m.bracket_slot === BRONZE_SLOT) continue; // podium handled below
    for (const tid of [m.home_team_id, m.away_team_id]) {
      if (tid && tid !== m.winner_team_id)
        lostRound.set(tid, Math.max(lostRound.get(tid) ?? 0, m.round));
    }
  }

  const placeOf = (id: string): number => {
    if (id === champ) return 0;
    if (finalLoser && id === finalLoser) return 1;
    if (bronzeWinner && id === bronzeWinner) return 2;
    if (bronzeLoser && id === bronzeLoser) return 3;
    return 4;
  };

  return [...teams].sort((a, b) => {
    const pa = placeOf(a.id);
    const pb = placeOf(b.id);
    if (pa !== pb) return pa - pb;
    const ra = lostRound.get(a.id) ?? 0;
    const rb = lostRound.get(b.id) ?? 0;
    if (rb !== ra) return rb - ra;
    return (a.seed ?? 99) - (b.seed ?? 99);
  });
}
