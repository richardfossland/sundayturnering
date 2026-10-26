// Swiss-system (format `swiss`): alle spiller N runder mot lag med lik stilling,
// ingen utslått, ingen omkamp når det kan unngås. Ren modul — ingen DB, ingen UI.
//
// Parringen er en maksimal vektet matching, slik dambrisco/swiss-pairing
// (MIT, https://github.com/dambrisco/swiss-pairing) gjør det: hvert lagpar får en
// vekt som favoriserer lik stilling (standingPower) og straffer omkamp tungt
// (rematchWeight). Matchingen løses av Edmonds' blossom-algoritme (vendoret i
// lib/vendor/edmonds-blossom.js, MIT). Koden er skrevet på nytt for våre typer;
// se THIRD-PARTY-NOTICES.md.
//
// Oddetall lag: en dummy-node i grafen er «frirunden». Kantene til dummyen straffer
// lag som har hatt bye før (tungt) og høyt rangerte lag (lett), så byen går til det
// lavest rangerte laget uten bye — i samme matching som resten, så den aldri tvinger
// fram en omkamp som kunne vært unngått. Alt er deterministisk: ingen tilfeldighet,
// lik rangering avgjøres av seed og navn.

import blossom from "@/lib/vendor/edmonds-blossom";
import { computeStandings } from "@/lib/tournament/standings";
import type { Match, ScoringConfig, Team, TiebreakConfig } from "@/lib/types";

export interface SwissPairing {
  homeId: string;
  /** null = dette laget har frirunde (bye). */
  awayId: string | null;
}

/** En allerede lagt kamp: hvem møtte hvem (`away` null = bye). */
export interface SwissPlayed {
  home: string;
  away: string | null;
}

export interface SwissInput {
  /** Lagene i rekkefølge: tabellrekkefølge (beste først), før runde 1 seed-rekkefølge. */
  ranked: string[];
  /** Poeng per lag nå (inkl. bye-poeng). */
  points: Map<string, number>;
  /** Poeng for en seier; enhet for «hvor langt unna i stilling». */
  pointsWin: number;
  /** Alle kamper lagt i tidligere runder (også byes). */
  played: SwissPlayed[];
}

/** Standardantall runder: ceil(log2 N) — nok til å skille en klar vinner. */
export function defaultSwissRounds(n: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
}

/** Flere runder enn ceil(log2 N) + 1 gir omkamper og gjentatte frirunder (veiviseren advarer). */
export function swissRoundsWarn(n: number, rounds: number): boolean {
  return rounds > defaultSwissRounds(n) + 1;
}

/** Gyldig antall runder: 1..N−1 (flere ville gitt omkamper). */
export function maxSwissRounds(n: number): number {
  return Math.max(1, n - 1);
}

/** Valider antall runder fra en ukjent kilde. Uten verdi → standard; ugyldig → "invalid". */
export function sanitiseSwissRounds(raw: unknown, teamCount: number): number | "invalid" {
  if (raw === undefined || raw === null) return defaultSwissRounds(teamCount);
  if (typeof raw !== "number" || !Number.isInteger(raw)) return "invalid";
  return raw >= 1 && raw <= maxSwissRounds(teamCount) ? raw : "invalid";
}

// Vekter (heltall — blossom regner trygt på dem). Rekkefølgen av prioritet:
//   omkamp  >  bye til lag som alt har hatt en  >  bye til høyt rangert lag  >  stillingsavstand.
const BASE = 1e13;
const REMATCH = 1e12;
const REPEAT_BYE = 1e11;
const BYE_RANK = 1e8; // per plass over bunnen
const SCORE_POWER = 2; // standingPower: kvadrert avstand → ujevne par er dyrere enn to små
const SCORE_UNIT = 1e4;

/** Første runde: øvre halvdel mot nedre (1–5, 2–6, 3–7, 4–8). Oddetall: bye til siste seed. */
function pairFirstRound(ranked: string[]): SwissPairing[] {
  const ids = [...ranked];
  const out: SwissPairing[] = [];
  let bye: string | null = null;
  if (ids.length % 2 === 1) bye = ids.pop()!;
  const half = ids.length / 2;
  for (let i = 0; i < half; i++) out.push({ homeId: ids[i], awayId: ids[i + half] });
  if (bye) out.push({ homeId: bye, awayId: null });
  return out;
}

/** Parring for neste runde. Se filhodet for vektene. */
export function pairSwissRound(input: SwissInput): SwissPairing[] {
  const { ranked, points, played } = input;
  const n = ranked.length;
  if (n < 2) return [];
  if (played.length === 0) return pairFirstRound(ranked);

  const unit = Math.max(1, input.pointsWin);
  const idx = new Map(ranked.map((id, i) => [id, i]));
  const met = new Set<string>();
  const hadBye = new Set<string>();
  const homes = new Map<string, number>();
  for (const p of played) {
    if (p.away === null) {
      hadBye.add(p.home);
      continue;
    }
    met.add(`${p.home}|${p.away}`);
    met.add(`${p.away}|${p.home}`);
    homes.set(p.home, (homes.get(p.home) ?? 0) + 1);
  }

  const odd = n % 2 === 1;
  const edges: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = ranked[i];
      const b = ranked[j];
      const d = Math.abs((points.get(a) ?? 0) - (points.get(b) ?? 0)) / unit;
      let pen = Math.round(Math.pow(d, SCORE_POWER) * SCORE_UNIT) + (j - i);
      if (met.has(`${a}|${b}`)) pen += REMATCH;
      edges.push([i, j, BASE - pen]);
    }
    if (odd) {
      // Lavest rangert = minst straff; straffen vokser jo høyere laget står.
      let pen = (n - 1 - i) * BYE_RANK;
      if (hadBye.has(ranked[i])) pen += REPEAT_BYE;
      edges.push([i, n, BASE - pen]);
    }
  }

  const mate = blossom(edges, true);
  const out: SwissPairing[] = [];
  const done = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (done.has(i)) continue;
    const j = mate[i];
    done.add(i);
    if (j === n || j === undefined || j < 0) {
      out.push({ homeId: ranked[i], awayId: null });
      continue;
    }
    done.add(j);
    out.push(orient(ranked[i], ranked[j], homes, idx));
  }
  // Rekkefølge på storskjermen: beste lag først, bye sist.
  out.sort((x, y) => {
    if ((x.awayId === null) !== (y.awayId === null)) return x.awayId === null ? 1 : -1;
    return Math.min(idx.get(x.homeId)!, idx.get(x.awayId ?? x.homeId)!) -
      Math.min(idx.get(y.homeId)!, idx.get(y.awayId ?? y.homeId)!);
  });
  return out;
}

/** Hjemmelaget er det som har spilt færrest hjemmekamper; likt → best rangert. */
function orient(a: string, b: string, homes: Map<string, number>, idx: Map<string, number>): SwissPairing {
  const ha = homes.get(a) ?? 0;
  const hb = homes.get(b) ?? 0;
  const aHome = ha !== hb ? ha < hb : idx.get(a)! < idx.get(b)!;
  return aHome ? { homeId: a, awayId: b } : { homeId: b, awayId: a };
}

// ---------- runde-oversikt og neste runde (rene funksjoner over lagrede kamper) ----------

/** Hvor langt Swiss-turneringen er kommet. */
export interface SwissProgress {
  /** Siste lagte runde (0 = ingen kamper ennå). */
  round: number;
  /** Totalt antall runder (config.swiss.rounds). */
  total: number;
  /** Kamper i siste runde som ikke er ferdige. */
  open: number;
  /** Siste runde er ferdigspilt. */
  complete: boolean;
  /** Alle runder er lagt og spilt: turneringen kan avsluttes. */
  finished: boolean;
}

export function swissProgress(matches: Match[], total: number): SwissProgress {
  const league = matches.filter((m) => m.phase === "league");
  const round = league.reduce((mx, m) => Math.max(mx, m.round), 0);
  const open = league.filter((m) => m.round === round && m.status !== "done" && m.status !== "bye").length;
  const complete = round > 0 && open === 0;
  return { round, total, open, complete, finished: complete && round >= total };
}

/** Parringene for neste runde, ut fra lagene og kampene så langt. Runde 1 følger
 * seed; senere runder følger tabellen (inkl. bye-poeng og tiebreak). */
export function planSwissRound(
  teams: Team[],
  matches: Match[],
  scoring: ScoringConfig,
  tiebreak?: TiebreakConfig,
): SwissPairing[] {
  const league = matches.filter((m) => m.phase === "league" && m.home_team_id != null);
  const bySeed = [...teams].sort(
    (a, b) => (a.seed ?? 1e9) - (b.seed ?? 1e9) || a.sort_order - b.sort_order || a.name.localeCompare(b.name, "no"),
  );
  if (league.length === 0)
    return pairSwissRound({ ranked: bySeed.map((t) => t.id), points: new Map(), pointsWin: scoring.pointsWin, played: [] });
  const rows = computeStandings(teams, matches, scoring, 0, tiebreak, { byeIsWin: true });
  return pairSwissRound({
    ranked: rows.map((r) => r.team_id),
    points: new Map(rows.map((r) => [r.team_id, r.points])),
    pointsWin: scoring.pointsWin,
    played: league.map((m) => ({ home: m.home_team_id!, away: m.away_team_id })),
  });
}
