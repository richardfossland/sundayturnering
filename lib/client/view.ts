// Small pure view helpers shared by board + control.
import type { Match, Team } from "@/lib/types";
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
