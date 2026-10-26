// Small pure view helpers shared by board + control.
import type { Match, StandingRow, Team, TournamentStatus } from "@/lib/types";
import type { StateDTO } from "@/lib/dto";
import { BRONZE_SLOT } from "@/lib/tournament/bracket";
import { no } from "@/lib/locale/no";
import { doubleElimOutcome } from "@/lib/tournament/doubleElim";
import { championId } from "@/lib/tournament/champion";
import { isPlayable } from "@/lib/tournament/courts";

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

/** The next scheduled (or called-to-court) matches in queue order (board "next up").
 * With the tournament status, league matches left unplayed when the playoff was
 * started early are left out: they can no longer be registered. */
export function upcoming(matches: Match[], limit = 5, tournamentStatus?: TournamentStatus): Match[] {
  return matches
    .filter((m) => (m.status === "scheduled" || m.status === "called") && m.home_team_id && m.away_team_id)
    .filter((m) => m.status === "called" || isPlayable(m, tournamentStatus))
    .sort((a, b) => a.queue_order - b.queue_order)
    .slice(0, limit);
}

/** Hovedbraketten (A) alene — B-sluttspillets finale kroner aldri mesteren. */
const inA = (m: Match) => (m.bracket ?? "A") === "A";

/** Vinneren av B-sluttspillet / trøsterunden, ellers null (ingen B, eller ikke avgjort). */
export function bChampionId(matches: Match[]): string | null {
  const b = matches.filter((m) => m.phase === "playoff" && m.bracket === "B");
  if (b.length === 0) return null;
  const finalRound = Math.max(...b.map((m) => m.round));
  return (
    b.find((m) => m.round === finalRound && m.bracket_slot === 0 && m.status === "done")
      ?.winner_team_id ?? null
  );
}

// Mesteren: én regel delt med speaker og resultatside (se champion.ts).
export { championId };

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

/** Hvor langt et lag kom i én brakett (A eller B); høyere = bedre.
 *   1000, 999, … = avgjort pallplass (mester, taper av finalen, bronse-vinner/-taper)
 *   500 + runde  = lag som ikke har tapt (turneringen ble avsluttet midt i), lengst kommet først
 *   runde        = runden laget røk ut i (senere = bedre)
 * Bronsefinalen teller ikke som en runde: begge lagene røk ut i semifinalen. Er den
 * spilt før finalen (tidlig avslutning), rangeres vinneren likevel over taperen. Laget som
 * ikke er med i braketten er ikke med i kartet. */
function bracketProgress(ms: Match[]): Map<string, number> {
  const out = new Map<string, number>();
  if (ms.length === 0) return out;
  const finalRound = Math.max(...ms.map((m) => m.round));
  const isBronze = (m: Match) => m.round === finalRound && m.bracket_slot === BRONZE_SLOT;
  const lost = new Map<string, number>();
  const reach = new Map<string, number>();
  for (const m of ms) {
    const sides = [m.home_team_id, m.away_team_id].filter((x): x is string => !!x);
    if (isBronze(m)) {
      // Å spille bronsefinale betyr å ha tapt semifinalen.
      for (const tid of sides) lost.set(tid, Math.max(lost.get(tid) ?? 0, finalRound - 1));
      // Spilt bronsefinale før finalen (tidlig avslutning): vinneren over taperen,
      // begge fortsatt under finalistene (500+) og over kvartfinaletaperne.
      if (m.status === "done" && m.winner_team_id)
        lost.set(m.winner_team_id, Math.max(lost.get(m.winner_team_id) ?? 0, finalRound - 0.5));
      continue;
    }
    for (const tid of sides) reach.set(tid, Math.max(reach.get(tid) ?? 0, m.round));
    if (m.status === "done" && m.winner_team_id)
      for (const tid of sides)
        if (tid !== m.winner_team_id) lost.set(tid, Math.max(lost.get(tid) ?? 0, m.round));
  }
  for (const tid of reach.keys())
    out.set(tid, lost.has(tid) ? lost.get(tid)! : 500 + reach.get(tid)!);
  for (const tid of lost.keys()) if (!out.has(tid)) out.set(tid, lost.get(tid)!);
  knockoutPodium(ms).forEach((tid, i) => out.set(tid, 1000 - i));
  return out;
}

/** Tabellrekkefølgen laget hadde (lavere = bedre), for lag som ikke avgjøres av sluttspillet.
 * Gruppespill: plassen i egen gruppe først (alle treere før alle firere), så rekord per kamp —
 * den flate tabellen blander grupper som aldri møtte hverandre. */
function tableOrder(state: StateDTO): Map<string, number> {
  const order = new Map<string, number>();
  const { standings, groupStandings } = state;
  if (groupStandings && groupStandings.length > 0) {
    const pg = (n: number, r: StandingRow) => (r.played > 0 ? n / r.played : 0);
    const rows = groupStandings
      .flatMap((g) => g.rows.map((r) => ({ r, g: g.group_no })))
      .filter(({ r }) => r.played > 0);
    rows.sort(
      (a, b) =>
        a.r.rank - b.r.rank ||
        pg(b.r.points, b.r) - pg(a.r.points, a.r) ||
        pg(b.r.diff, b.r) - pg(a.r.diff, a.r) ||
        pg(b.r.scoreFor, b.r) - pg(a.r.scoreFor, a.r) ||
        a.g - b.g,
    );
    rows.forEach(({ r }, i) => order.set(r.team_id, i));
    return order;
  }
  if (standings.some((s) => s.played > 0)) standings.forEach((s, i) => order.set(s.team_id, i));
  return order;
}

/** Final ranking of all teams for the results/diploma page.
 *
 * Bracket first: champion, final loser, bronze winner and loser (when a bronze final
 * is played) — the bracket decided those, not the league table. Then everyone else in
 * the A bracket by how far they got (later exit = better); a team that has not lost
 * yet (tournament ended early) ranks above those knocked out. Then the B bracket by
 * how far each team got there (B champion first); a team in both A and B (cup
 * consolation) keeps its A rank and is split by B. Teams that never reached a
 * playoff follow in table order. The table (or seed) only breaks ties inside the same
 * elimination round — a quarter-final loser never outranks a semi-final loser. */
export function finalRanking(state: StateDTO): Team[] {
  const { teams, matches } = state;
  if (state.tournament.format === "double_elim") return doubleElimRanking(teams, matches);
  const playoff = matches.filter((m) => m.phase === "playoff");
  const aProgress = bracketProgress(playoff.filter(inA));
  const bProgress = bracketProgress(playoff.filter((m) => m.bracket === "B"));
  const table = tableOrder(state);

  return [...teams].sort((a, b) => {
    const pa = aProgress.get(a.id) ?? -1;
    const pb = aProgress.get(b.id) ?? -1;
    if (pa !== pb) return pb - pa;
    const ba = bProgress.get(a.id) ?? -1;
    const bb = bProgress.get(b.id) ?? -1;
    if (ba !== bb) return bb - ba;
    const ta = table.get(a.id) ?? 9999;
    const tb = table.get(b.id) ?? 9999;
    if (ta !== tb) return ta - tb;
    return (a.seed ?? 99) - (b.seed ?? 99);
  });
}

/** Dobbel utslag: 1 = vinneren av avgjørende finale, 2 = taperen, 3 = taperen av
 * taperfinalen. Resten etter hvor sent de røk ut av taperbraketten (senere = bedre),
 * så seed. Avsluttes turneringen før finalen er avgjort, står lag som ikke har røket
 * ut av taperbraketten (storfinalistene først) over de som er ute. */
function doubleElimRanking(teams: Team[], matches: Match[]): Team[] {
  const out = doubleElimOutcome(matches);
  const podium = out ? [out.champion, out.runnerUp, out.third].filter((id): id is string => !!id) : [];
  const podiumRank = new Map(podium.map((id, i) => [id, i]));
  const outRound = new Map<string, number>();
  for (const m of matches) {
    if (m.bracket !== "L" || m.status !== "done" || !m.winner_team_id) continue;
    for (const tid of [m.home_team_id, m.away_team_id])
      if (tid && tid !== m.winner_team_id) outRound.set(tid, Math.max(outRound.get(tid) ?? 0, m.round));
  }
  const inGrandFinal = new Set(
    matches.filter((m) => m.bracket === "GF").flatMap((m) => [m.home_team_id, m.away_team_id]),
  );
  // Lag som ikke har røket ut ennå: bare relevant når finalen ikke er avgjort.
  const alive = (id: string) => !out && !outRound.has(id);
  const key = (id: string) =>
    podiumRank.has(id) ? 1000 - podiumRank.get(id)! : alive(id) ? (inGrandFinal.has(id) ? 502 : 501) : (outRound.get(id) ?? 0);
  return [...teams].sort((a, b) => {
    const ka = key(a.id);
    const kb = key(b.id);
    if (ka !== kb) return kb - ka;
    return (a.seed ?? 99) - (b.seed ?? 99);
  });
}

/** Klokkeslett (HH:MM, norsk tid) for en planlagt kamp, eller null uten tidsplan. */
export function matchTime(scheduledAt: string | null | undefined): string | null {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(d);
}
