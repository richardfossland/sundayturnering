// Awards / superlatives (spec extension) — PURE, sport-agnostic, unit-testable.
// Derives "team of the night", most wins, biggest win, highest-scoring match,
// and best attack/defense from the match log + standings. Score-based awards are
// skipped for the winner-only profile (no magnitudes to compare).

import type { Match, ScoringConfig, StandingRow, Team } from "@/lib/types";
import { resolve, isVoid } from "@/lib/tournament/scoring";
import { aw } from "@/lib/locale/no";

export interface Award {
  kind:
    | "team_of_night"
    | "most_wins"
    | "biggest_win"
    | "highest_scoring"
    | "best_attack"
    | "best_defense";
  label: string;
  detail: string;
  teamId?: string;
}

function playable(matches: Match[]): Match[] {
  return matches.filter(
    (m) =>
      m.status === "done" &&
      m.result != null &&
      m.home_team_id != null &&
      m.away_team_id != null &&
      !isVoid(m.result),
  );
}

export function computeAwards(
  teams: Team[],
  matches: Match[],
  standings: StandingRow[],
  cfg: ScoringConfig,
): Award[] {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const name = (id?: string | null) => (id ? byId.get(id)?.name ?? "?" : "?");
  const done = playable(matches);
  const out: Award[] = [];
  const hasScores = cfg.profile !== "winner";

  // Team of the night: the rank-1 team (champion / table-topper) once played.
  const top = standings.find((s) => s.rank === 1 && s.played > 0);
  if (top)
    out.push({
      kind: "team_of_night",
      label: aw.teamOfNight,
      teamId: top.team_id,
      detail: name(top.team_id),
    });

  // Most wins across all (league + playoff) matches.
  const wins = new Map<string, number>();
  for (const m of done)
    if (m.winner_team_id)
      wins.set(m.winner_team_id, (wins.get(m.winner_team_id) ?? 0) + 1);
  let best: [string, number] | null = null;
  for (const [id, c] of wins) if (!best || c > best[1]) best = [id, c];
  if (best && best[1] > 0)
    out.push({
      kind: "most_wins",
      label: aw.mostWins,
      teamId: best[0],
      detail: aw.wins(best[1]),
    });

  if (hasScores) {
    let biggest: { m: Match; margin: number; hi: number; lo: number; winner: "home" | "away" } | null = null;
    let highest: { m: Match; total: number; hs: number; as: number } | null = null;
    for (const m of done) {
      const r = resolve(cfg.profile, m.result!, cfg);
      const total = r.homeScore + r.awayScore;
      if (!highest || total > highest.total)
        highest = { m, total, hs: r.homeScore, as: r.awayScore };
      if (r.winner !== "draw") {
        const margin = Math.abs(r.homeScore - r.awayScore);
        if (!biggest || margin > biggest.margin)
          biggest = {
            m,
            margin,
            hi: Math.max(r.homeScore, r.awayScore),
            lo: Math.min(r.homeScore, r.awayScore),
            winner: r.winner,
          };
      }
    }

    if (biggest && biggest.margin > 0) {
      const w =
        biggest.winner === "home" ? biggest.m.home_team_id : biggest.m.away_team_id;
      const l =
        biggest.winner === "home" ? biggest.m.away_team_id : biggest.m.home_team_id;
      out.push({
        kind: "biggest_win",
        label: aw.biggestWin,
        teamId: w ?? undefined,
        detail: `${name(w)} ${biggest.hi}–${biggest.lo} ${name(l)}`,
      });
    }

    if (highest && highest.total > 0)
      out.push({
        kind: "highest_scoring",
        label: aw.highestScoring,
        detail: `${name(highest.m.home_team_id)} ${highest.hs}–${highest.as} ${name(highest.m.away_team_id)}`,
      });

    const played = standings.filter((s) => s.played > 0);
    if (played.length) {
      const atk = [...played].sort((a, b) => b.scoreFor - a.scoreFor)[0];
      out.push({
        kind: "best_attack",
        label: aw.bestAttack,
        teamId: atk.team_id,
        detail: aw.scored(atk.scoreFor),
      });
      const def = [...played].sort((a, b) => a.scoreAgainst - b.scoreAgainst)[0];
      out.push({
        kind: "best_defense",
        label: aw.bestDefense,
        teamId: def.team_id,
        detail: aw.conceded(def.scoreAgainst),
      });
    }
  }

  return out;
}
