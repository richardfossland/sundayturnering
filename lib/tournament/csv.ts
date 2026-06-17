// CSV export (spec extension) — PURE string builders, unit-testable. Uses ';'
// as the delimiter (the default Excel expects in Norwegian locales) and CRLF
// rows. Values are escaped/quoted when they contain a delimiter, quote, or
// newline.

import type { Match, ScoringConfig, StandingRow, Team } from "@/lib/types";
import { resolve } from "@/lib/tournament/scoring";

function esc(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(esc).join(";")).join("\r\n");
}

/** The match log: one row per non-bye match, in queue order. */
export function matchesCsv(
  teams: Team[],
  matches: Match[],
  scoring: ScoringConfig,
): string {
  const name = (id?: string | null) =>
    id ? teams.find((t) => t.id === id)?.name ?? "" : "";
  const header = [
    "Fase",
    "Runde",
    "Hjemmelag",
    "Bortelag",
    "Resultat",
    "Vinner",
    "Status",
  ];
  const body = matches
    .filter((m) => m.status !== "bye")
    .slice()
    .sort((a, b) => a.queue_order - b.queue_order)
    .map((m) => {
      const r = m.result ? resolve(scoring.profile, m.result, scoring) : null;
      return [
        m.phase,
        String(m.round),
        name(m.home_team_id),
        name(m.away_team_id),
        r?.display ?? "",
        name(m.winner_team_id),
        m.status,
      ];
    });
  return toCsv([header, ...body]);
}

/** The standings table as CSV. */
export function standingsCsv(
  teams: Team[],
  standings: StandingRow[],
): string {
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "";
  const header = ["#", "Lag", "K", "S", "U", "T", "For", "Mot", "±", "P"];
  const body = standings.map((r) => [
    String(r.rank),
    name(r.team_id),
    String(r.played),
    String(r.won),
    String(r.drawn),
    String(r.lost),
    String(r.scoreFor),
    String(r.scoreAgainst),
    String(r.diff),
    String(r.points),
  ]);
  return toCsv([header, ...body]);
}
