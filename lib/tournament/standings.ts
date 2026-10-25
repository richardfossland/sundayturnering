// League standings (spec §7) — reduce done league matches into a sorted table.
// Pure. Rekkefølgen ved likt er konfigurerbar (`TiebreakConfig`); standard er
// points → score diff → scored → head-to-head → name.
//
// Innbyrdes oppgjør (h2h_*) er en minitabell: når 2+ lag er like på et h2h-steg
// regnes en tabell KUN av kampene mellom de like lagene. Splitter den gruppen
// bare delvis, kjøres prosedyren på nytt for hver gruppe som fortsatt er lik.
// Ideen er portet fra CourtHive tods-competition-factory (MIT),
// `roundRobinTally/getGroupOrder.ts` — se THIRD-PARTY-NOTICES.md.
//
// Swiss-kriteriene (Buchholz, Buchholz uten laveste, Sonneborn-Berger) bygger på
// ideene i @echecs/buchholz og @echecs/sonneborn-berger (MIT) — se THIRD-PARTY-NOTICES.md.

import type {
  Match,
  ScoringConfig,
  StandingRow,
  Team,
  TiebreakConfig,
  TiebreakKey,
  TiebreakPreset,
} from "@/lib/types";
import { isVoid, leaguePoints, resolve } from "@/lib/tournament/scoring";

export const TIEBREAK_PRESETS: Record<TiebreakPreset, TiebreakKey[]> = {
  // Dagens oppførsel: poeng → diff → scoret → innbyrdes poeng → navn.
  standard: ["points", "diff", "scored", "h2h_points", "name"],
  uefa: ["points", "h2h_points", "h2h_diff", "h2h_scored", "diff", "scored", "wins", "name"],
  // Swiss: poeng → Buchholz → Sonneborn-Berger → innbyrdes → diff → navn.
  swiss: ["points", "buchholz", "sonneborn_berger", "h2h_points", "diff", "name"],
};

export const TIEBREAK_KEYS: readonly TiebreakKey[] = [
  "points", "diff", "scored", "wins", "h2h_points", "h2h_diff", "h2h_scored",
  "buchholz", "buchholz_cut1", "sonneborn_berger", "name",
];

/** Løs opp forhåndsvalg/liste til en rekkefølge. Ukjent verdi → standard. */
export function resolveTiebreak(cfg: TiebreakConfig | undefined | null): TiebreakKey[] {
  if (Array.isArray(cfg)) {
    const keys = cfg.filter((k): k is TiebreakKey => TIEBREAK_KEYS.includes(k));
    return keys.length ? keys : TIEBREAK_PRESETS.standard;
  }
  return TIEBREAK_PRESETS[cfg as TiebreakPreset] ?? TIEBREAK_PRESETS.standard;
}

/** Valider/rens tiebreak fra en ukjent kilde (API-body, lagret jsonb).
 * `undefined`/`null` = ikke satt (gyldig). `"invalid"` = forsøkt, men ugyldig. */
export function sanitiseTiebreak(raw: unknown): TiebreakConfig | undefined | "invalid" {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "string") {
    return raw in TIEBREAK_PRESETS ? (raw as TiebreakPreset) : "invalid";
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > TIEBREAK_KEYS.length) return "invalid";
  const out: TiebreakKey[] = [];
  for (const k of raw) {
    if (typeof k !== "string" || !TIEBREAK_KEYS.includes(k as TiebreakKey)) return "invalid";
    if (!out.includes(k as TiebreakKey)) out.push(k as TiebreakKey);
  }
  return out;
}

interface Acc extends StandingRow {
  name: string;
}

export interface StandingsOptions {
  /** Swiss: en oddetalls-bye gir seier (poeng etter poengoppsettet), men ingen mål.
   * Uten dette teller byes ikke i tabellen (liga med oddetall lag). */
  byeIsWin?: boolean;
}

/** Compute standings for the league phase.
 * @param playoffCut top-N teams marked inPlayoff (0 = no cut line). */
export function computeStandings(
  teams: Team[],
  matches: Match[],
  cfg: ScoringConfig,
  playoffCut = 0,
  tiebreak?: TiebreakConfig,
  opts: StandingsOptions = {},
): StandingRow[] {
  const profile = cfg.profile;
  const acc = new Map<string, Acc>();
  for (const t of teams) {
    acc.set(t.id, {
      team_id: t.id,
      name: t.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      points: 0,
      scoreFor: 0,
      scoreAgainst: 0,
      diff: 0,
      rank: 0,
      inPlayoff: false,
    });
  }

  const leagueDone = matches.filter(
    (m) =>
      m.phase === "league" &&
      m.status === "done" &&
      m.result != null &&
      m.away_team_id != null && // byes don't count toward the table
      !isVoid(m.result), // abandoned/annulled matches are voided
  );

  for (const m of leagueDone) {
    const home = acc.get(m.home_team_id!);
    const away = acc.get(m.away_team_id!);
    if (!home || !away) continue;
    const { winner, homeScore, awayScore } = resolve(profile, m.result!, cfg);
    const pts = leaguePoints(m.result!, profile, cfg);

    home.played++;
    away.played++;
    home.scoreFor += homeScore;
    home.scoreAgainst += awayScore;
    away.scoreFor += awayScore;
    away.scoreAgainst += homeScore;
    home.points += pts.home;
    away.points += pts.away;

    if (winner === "draw") {
      home.drawn++;
      away.drawn++;
    } else if (winner === "home") {
      home.won++;
      away.lost++;
    } else {
      away.won++;
      home.lost++;
    }
  }

  // Swiss-bye: seier uten motstander. Teller ikke i Buchholz/SB (ingen motstander).
  const byes = opts.byeIsWin
    ? matches.filter(
        (m) =>
          m.phase === "league" &&
          m.status === "bye" &&
          m.away_team_id == null &&
          m.home_team_id != null &&
          acc.has(m.home_team_id),
      )
    : [];
  for (const m of byes) {
    const r = acc.get(m.home_team_id!)!;
    r.played++;
    r.won++;
    r.points += cfg.pointsWin;
  }

  for (const r of acc.values()) r.diff = r.scoreFor - r.scoreAgainst;

  // Form guide: each team's results in chronological (queue) order.
  const formMap = new Map<string, ("W" | "D" | "L")[]>();
  const push = (id: string, v: "W" | "D" | "L") => {
    const arr = formMap.get(id) ?? [];
    arr.push(v);
    formMap.set(id, arr);
  };
  for (const m of byes) push(m.home_team_id!, "W");
  for (const m of [...leagueDone].sort((a, b) => a.queue_order - b.queue_order)) {
    const { winner } = resolve(profile, m.result!, cfg);
    push(m.home_team_id!, winner === "draw" ? "D" : winner === "home" ? "W" : "L");
    push(m.away_team_id!, winner === "draw" ? "D" : winner === "away" ? "W" : "L");
  }

  const games: Game[] = leagueDone.map((m) => {
    const { homeScore, awayScore, winner } = resolve(profile, m.result!, cfg);
    const pts = leaguePoints(m.result!, profile, cfg);
    return {
      home: m.home_team_id!,
      away: m.away_team_id!,
      homeScore,
      awayScore,
      homePts: pts.home,
      awayPts: pts.away,
      winner,
    };
  });
  const ctx: Ctx = { games, points: new Map([...acc.values()].map((r) => [r.team_id, r.points])) };
  const rows = orderTied(
    [...acc.values()],
    resolveTiebreak(tiebreak),
    ctx,
  );

  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.inPlayoff = playoffCut > 0 && i < playoffCut;
  });

  // Project to the public StandingRow shape (drop the private `name`).
  return rows.map(
    (r): StandingRow => ({
      team_id: r.team_id,
      played: r.played,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      points: r.points,
      scoreFor: r.scoreFor,
      scoreAgainst: r.scoreAgainst,
      diff: r.diff,
      rank: r.rank,
      inPlayoff: r.inPlayoff,
      form: (formMap.get(r.team_id) ?? []).slice(-5),
    }),
  );
}

export interface GroupStanding {
  group_no: number;
  rows: StandingRow[];
}

/** Per-group standings for the group_playoff format. Runs the same reducer
 * (incl. head-to-head + tiebreaks) restricted to each group's teams + matches,
 * marking the top `advancePerGroup` of each group as inPlayoff. */
export function computeGroupStandings(
  teams: Team[],
  matches: Match[],
  cfg: ScoringConfig,
  advancePerGroup: number,
  tiebreak?: TiebreakConfig,
): GroupStanding[] {
  const groupNos = [
    ...new Set(
      teams.map((t) => t.group_no).filter((g): g is number => g != null),
    ),
  ].sort((a, b) => a - b);

  return groupNos.map((g) => ({
    group_no: g,
    rows: computeStandings(
      teams.filter((t) => t.group_no === g),
      matches.filter((m) => m.group_no === g),
      cfg,
      advancePerGroup,
      tiebreak,
    ),
  }));
}

interface Game {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  homePts: number;
  awayPts: number;
  winner: "home" | "away" | "draw";
}

/** Det rekkefølgen trenger: de spilte kampene og hvert lags totale poeng
 * (motstanderes poeng til Buchholz/Sonneborn-Berger). */
interface Ctx {
  games: Game[];
  points: Map<string, number>;
}

/** Totaler for ett lag over en delmengde kamper. */
function tally(id: string, games: Game[]) {
  let points = 0;
  let scored = 0;
  let against = 0;
  for (const g of games) {
    if (g.home === id) {
      points += g.homePts;
      scored += g.homeScore;
      against += g.awayScore;
    } else if (g.away === id) {
      points += g.awayPts;
      scored += g.awayScore;
      against += g.homeScore;
    }
  }
  return { points, scored, diff: scored - against };
}

/** Verdi (høyere = bedre) for et lag på et kriterium. `name` håndteres separat.
 * Nye kriterier (Buchholz, Sonneborn-Berger …) legges til her. */
function keyValue(key: TiebreakKey, r: Acc, group: Set<string>, ctx: Ctx): number {
  const { games, points } = ctx;
  switch (key) {
    case "points": return r.points;
    case "diff": return r.diff;
    case "scored": return r.scoreFor;
    case "wins": return r.won;
    case "h2h_points":
    case "h2h_diff":
    case "h2h_scored": {
      // Minitabell: bare kamper der begge lag er blant de like.
      const mini = games.filter((g) => group.has(g.home) && group.has(g.away));
      const t = tally(r.team_id, mini);
      return key === "h2h_points" ? t.points : key === "h2h_diff" ? t.diff : t.scored;
    }
    case "buchholz":
    case "buchholz_cut1": {
      // Sum av motstandernes poeng; «cut1» uten den laveste (FIDE).
      const opp = opponentPoints(r.team_id, games, points);
      const sum = opp.reduce((a, b) => a + b, 0);
      return key === "buchholz" || opp.length === 0 ? sum : sum - Math.min(...opp);
    }
    case "sonneborn_berger": {
      // Hel seier gir motstanderens poeng, uavgjort halvparten, tap ingenting.
      let sb = 0;
      for (const g of games) {
        const mine = g.home === r.team_id ? "home" : g.away === r.team_id ? "away" : null;
        if (!mine) continue;
        const opp = points.get(mine === "home" ? g.away : g.home) ?? 0;
        if (g.winner === "draw") sb += opp / 2;
        else if (g.winner === mine) sb += opp;
      }
      return sb;
    }
    default: return 0;
  }
}

/** Poengene til hver motstander laget har møtt (en per spilt kamp). */
function opponentPoints(id: string, games: Game[], points: Map<string, number>): number[] {
  const out: number[] = [];
  for (const g of games) {
    if (g.home === id) out.push(points.get(g.away) ?? 0);
    else if (g.away === id) out.push(points.get(g.home) ?? 0);
  }
  return out;
}

const byName = (a: Acc, b: Acc) => a.name.localeCompare(b.name, "no");

/** Sorter `group` etter `keys`. Hvert kriterium deler gruppen i nivåer; nivåer
 * med 2+ lag går videre til neste kriterium. Splitter et h2h-steg gruppen bare
 * delvis, startes hele prosedyren på nytt for hver undergruppe (minitabell over
 * færre lag). Alltid deterministisk: navn (nb) til slutt. */
function orderTied(group: Acc[], keys: TiebreakKey[], ctx: Ctx): Acc[] {
  if (group.length <= 1) return group;
  const ids = new Set(group.map((r) => r.team_id));
  for (const key of keys) {
    if (key === "name") break;
    const val = new Map(group.map((r) => [r.team_id, keyValue(key, r, ids, ctx)]));
    const sorted = [...group].sort((a, b) => val.get(b.team_id)! - val.get(a.team_id)!);
    const levels: Acc[][] = [];
    for (const r of sorted) {
      const last = levels[levels.length - 1];
      if (last && val.get(last[0].team_id) === val.get(r.team_id)) last.push(r);
      else levels.push([r]);
    }
    if (levels.length === 1) continue; // kriteriet skilte ingen — neste
    const isH2h = key.startsWith("h2h_");
    // Overall-kriterier: nivåene er endelige i denne rekkefølgen, så restkriteriene
    // brukes videre. h2h delvis splitt: på nytt fra start (minitabell per undergruppe).
    const rest = isH2h ? keys : keys.slice(keys.indexOf(key) + 1);
    return levels.flatMap((lv) => orderTied(lv, rest, ctx));
  }
  return [...group].sort(byName);
}
