// Utskrift (A4): rene hjelpere for kampprogram, kampkort og banekort. Ingen
// DB, ingen UI — siden `/skriv-ut/[id]` bare tegner det disse returnerer.
//
// Idéene er hentet fra CourtHive TMX (banekort) og Tournify/Cup2000 (resultatark);
// våre kort kan i tillegg bære lagfarger/logo og en QR rett til kampen.

import type { Court, Match, ScoringConfig, Team } from "@/lib/types";
import { BRONZE_SLOT } from "@/lib/tournament/bracket";
import { bracketRoundLabel } from "@/lib/client/view";
import { no } from "@/lib/locale/no";

type MatchLike = Pick<
  Match,
  | "id"
  | "phase"
  | "round"
  | "bracket_slot"
  | "group_no"
  | "court_id"
  | "queue_order"
  | "scheduled_at"
  | "home_team_id"
  | "away_team_id"
  | "status"
>;

/** Klokkeslett først (uten tid sist), så køen. */
export function byPrintOrder(a: MatchLike, b: MatchLike): number {
  const ta = a.scheduled_at ? Date.parse(a.scheduled_at) : Infinity;
  const tb = b.scheduled_at ? Date.parse(b.scheduled_at) : Infinity;
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.queue_order - b.queue_order;
}

const known = (m: MatchLike) => m.home_team_id !== null && m.away_team_id !== null;

/** Antall sluttspillrunder (for «Finale»/«Semifinale»-navn). */
export function playoffRounds(matches: MatchLike[]): number {
  let max = 0;
  for (const m of matches) if (m.phase === "playoff") max = Math.max(max, m.round);
  return max;
}

/** «Gruppe A · Runde 2», «Semifinale», «Bronsefinale» eller «Runde 3». */
export function roundText(m: MatchLike, totalPlayoffRounds: number): string {
  if (m.phase === "playoff") {
    if (m.bracket_slot === BRONZE_SLOT && m.round === totalPlayoffRounds) return no.board.bronze;
    return bracketRoundLabel(m.round, totalPlayoffRounds);
  }
  const round = `${no.board.round} ${m.round}`;
  if (m.group_no === null) return round;
  return `${no.board.group} ${String.fromCharCode(65 + m.group_no)} · ${round}`;
}

/** Kampene som skal ha kort: alt som ikke er ferdig eller fri runde. Med
 * `onlyKnownTeams` hoppes sluttspillkamper der lagene ikke er avgjort over. */
export function cardMatches<M extends MatchLike>(matches: M[], onlyKnownTeams = false): M[] {
  return matches
    .filter((m) => m.status !== "done" && m.status !== "bye")
    .filter((m) => !onlyKnownTeams || known(m))
    .sort(byPrintOrder);
}

export interface CourtProgramme<M extends MatchLike = MatchLike> {
  /** Null = kamper uten fast bane. */
  court: Pick<Court, "id" | "name"> | null;
  matches: M[];
}

/** Kampprogram per bane: banene i rekkefølge, så kamper uten bane. Fri runde
 * utelates; ferdige kamper er med (programmet er hele dagen). */
export function programmeByCourt<M extends MatchLike>(
  matches: M[],
  courts: Pick<Court, "id" | "name" | "sort_order">[],
  onlyKnownTeams = false,
): CourtProgramme<M>[] {
  const real = matches.filter((m) => m.status !== "bye").filter((m) => !onlyKnownTeams || known(m));
  const out: CourtProgramme<M>[] = [...courts]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((court) => ({
      court,
      matches: real.filter((m) => m.court_id === court.id).sort(byPrintOrder),
    }));
  const free = real.filter((m) => !m.court_id || !courts.some((c) => c.id === m.court_id));
  if (free.length > 0) out.push({ court: null, matches: free.sort(byPrintOrder) });
  return out.filter((g) => g.matches.length > 0);
}

export interface TeamProgramme<M extends MatchLike = MatchLike> {
  team: Team;
  matches: M[];
}

/** Hvert lags egne kamper, lagene i oppsettets rekkefølge. */
export function programmeByTeam<M extends MatchLike>(
  matches: M[],
  teams: Team[],
  onlyKnownTeams = false,
): TeamProgramme<M>[] {
  const real = matches.filter((m) => m.status !== "bye").filter((m) => !onlyKnownTeams || known(m));
  return [...teams]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "nb"))
    .map((team) => ({
      team,
      matches: real
        .filter((m) => m.home_team_id === team.id || m.away_team_id === team.id)
        .sort(byPrintOrder),
    }))
    .filter((g) => g.matches.length > 0);
}

export type ScoreBoxes =
  | { kind: "simple" }
  | { kind: "sets"; sets: number }
  | { kind: "winner" };

/** Resultatrutene kortet trenger, etter poengprofilen. */
export function scoreBoxes(scoring: Pick<ScoringConfig, "profile" | "setsBestOf">): ScoreBoxes {
  if (scoring.profile === "sets") {
    const n = scoring.setsBestOf ?? 3;
    return { kind: "sets", sets: Number.isInteger(n) && n >= 1 && n <= 9 ? n : 3 };
  }
  return scoring.profile === "winner" ? { kind: "winner" } : { kind: "simple" };
}

/** QR-lenke som kobler en dommer og åpner akkurat denne kampen. */
export function controlMatchUrl(base: string, code: string, matchId: string): string {
  const q = new URLSearchParams({ code, match: matchId });
  return `${base}/kontroll?${q.toString()}`;
}

/** QR-lenke som kobler en dommer og fester banen. */
export function controlCourtUrl(base: string, code: string, courtId: string): string {
  const q = new URLSearchParams({ code, court: courtId });
  return `${base}/kontroll?${q.toString()}`;
}
