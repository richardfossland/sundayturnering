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

export interface AwardOptions {
  /** Turneringens mester (se `championId`), eller null/udefinert når ingen er kåret. */
  championId?: string | null;
  /** Gruppespill: den flate tabellen blander grupper som aldri møtte hverandre, så den
   * kårer ikke «kveldens lag». */
  groupPlay?: boolean;
}

/** «2,5» — snitt per kamp med komma, ett desimal (heltall vises uten desimal). */
function perMatch(total: number, n: number): string {
  const v = Math.round((total / n) * 10) / 10;
  return String(v).replace(".", ",");
}

export function computeAwards(
  teams: Team[],
  matches: Match[],
  standings: StandingRow[],
  cfg: ScoringConfig,
  opts: AwardOptions = {},
): Award[] {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const name = (id?: string | null) => (id ? byId.get(id)?.name ?? "?" : "?");
  const done = playable(matches);
  const out: Award[] = [];
  const hasScores = cfg.profile !== "winner";

  // Team of the night: the champion when the tournament has one (a table-topper who
  // lost the final is not the team of the night), else the table leader once played.
  const night =
    opts.championId && byId.has(opts.championId)
      ? opts.championId
      : opts.groupPlay
        ? undefined
        : standings.find((s) => s.rank === 1 && s.played > 0)?.team_id;
  if (night)
    out.push({
      kind: "team_of_night",
      label: aw.teamOfNight,
      teamId: night,
      detail: name(night),
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

    // Angrep/forsvar per kamp (totaler favoriserer lag med flere kamper), regnet fra alle
    // spilte kamper — også sluttspill og tvers av grupper. Likt snitt: flest kamper først.
    const tally = new Map<string, { for: number; against: number; n: number }>();
    for (const m of done) {
      const r = resolve(cfg.profile, m.result!, cfg);
      for (const [id, f, a] of [
        [m.home_team_id!, r.homeScore, r.awayScore],
        [m.away_team_id!, r.awayScore, r.homeScore],
      ] as const) {
        const t = tally.get(id) ?? { for: 0, against: 0, n: 0 };
        t.for += f;
        t.against += a;
        t.n++;
        tally.set(id, t);
      }
    }
    const rows = [...tally.entries()].filter(([, t]) => t.n > 0);
    // a før b når a.x/a.n er bedre enn b.x/b.n (krysskalt: heltall, ingen avrundingsfeil).
    const best = (key: "for" | "against", sign: 1 | -1) =>
      rows.reduce<[string, { for: number; against: number; n: number }] | null>((acc, row) => {
        if (!acc) return row;
        const [, a] = acc;
        const [, b] = row;
        const cmp = sign * (b[key] * a.n - a[key] * b.n); // > 0: row er bedre
        return cmp > 0 || (cmp === 0 && b.n > a.n) ? row : acc;
      }, null);
    const atk = best("for", 1);
    if (atk)
      out.push({
        kind: "best_attack",
        label: aw.bestAttack,
        teamId: atk[0],
        detail: aw.scoredPerMatch(perMatch(atk[1].for, atk[1].n)),
      });
    const def = best("against", -1);
    if (def)
      out.push({
        kind: "best_defense",
        label: aw.bestDefense,
        teamId: def[0],
        detail: aw.concededPerMatch(perMatch(def[1].against, def[1].n)),
      });
  }

  return out;
}
