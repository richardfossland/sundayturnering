// Scoring profiles (spec §3) — the PURE half: validate a raw result, decide the
// winner + display string, and contribute league points. The React input UI
// lives in app code (lib/client/ResultInput.tsx); keeping resolve/points here
// makes them unit-testable with no UI coupling.

import type {
  MatchResult,
  ScoringConfig,
  ScoringProfileKey,
  SetsResult,
  SimpleResult,
  SpecialResult,
  WinnerResult,
} from "@/lib/types";

export type Outcome = "home" | "away" | "draw";

/** Default scoreline credited to a walkover/DQ winner when the config omits one. */
const DEFAULT_WALKOVER: [number, number] = [1, 0];

function isSpecial(result: unknown): result is SpecialResult {
  return result != null && typeof result === "object" && "special" in result;
}

/** A voided match (abandoned/annulled) contributes nothing to the standings —
 * no points, no played count, like a bye. */
export function isVoid(result: MatchResult | null | undefined): boolean {
  return isSpecial(result) && result.special === "abandoned";
}

export interface Resolved {
  winner: Outcome;
  display: string; // e.g. "3–1" or "2–1 (25–20, 23–25, 15–10)"
  /** Profile-specific magnitudes that feed standings (scoreFor/Against). */
  homeScore: number;
  awayScore: number;
}

export interface LeaguePoints {
  home: number;
  away: number;
}

const EN_DASH = "–";

// ---------- validation ----------

/** Validate a raw result object against the active profile. Returns an error
 * string (Norwegian) or null if valid. Used by the API before persisting. */
export function validateResult(
  profile: ScoringProfileKey,
  result: unknown,
  cfg: ScoringConfig,
): string | null {
  if (result == null || typeof result !== "object")
    return "Mangler resultat.";
  const r = result as Record<string, unknown>;

  // Special outcomes are profile-independent — validate them first.
  if ("special" in r) {
    const kind = r.special;
    if (kind !== "walkover" && kind !== "disqualification" && kind !== "abandoned")
      return "Ukjent spesialresultat.";
    if (kind === "abandoned") {
      if (r.winner != null) return "En avbrutt kamp har ingen vinner.";
      return null;
    }
    if (r.winner !== "home" && r.winner !== "away")
      return "Velg hvilket lag som går videre.";
    return null;
  }

  if (profile === "simple") {
    if (!isInt(r.home) || !isInt(r.away)) return "Begge lag må ha et tall.";
    if ((r.home as number) < 0 || (r.away as number) < 0)
      return "Tall kan ikke være negative.";
    if (r.home === r.away && !cfg.allowDraw)
      return "Uavgjort er ikke tillatt i denne turneringen.";
    return null;
  }

  if (profile === "sets") {
    const sets = r.sets;
    if (!Array.isArray(sets) || sets.length === 0)
      return "Legg til minst ett sett.";
    for (const s of sets) {
      if (
        !Array.isArray(s) ||
        s.length !== 2 ||
        !isInt(s[0]) ||
        !isInt(s[1]) ||
        s[0] < 0 ||
        s[1] < 0
      )
        return "Hvert sett må ha to gyldige tall.";
      if (s[0] === s[1]) return "Et sett kan ikke ende uavgjort.";
    }
    const { home, away } = countSets(sets as [number, number][]);
    if (home === away) return "Kampen kan ikke ende likt på sett.";
    return null;
  }

  if (profile === "winner") {
    if (r.winner !== "home" && r.winner !== "away")
      return "Velg hvem som vant.";
    return null;
  }

  return "Ukjent poengprofil.";
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/** Turn validated raw input into the canonical stored result. For sets, the
 * home/away set counts are recomputed server-side (never trusted from client).
 * Call only after validateResult returns null. */
export function canonicaliseResult(
  profile: ScoringProfileKey,
  raw: Record<string, unknown>,
): MatchResult {
  if ("special" in raw) {
    const kind = raw.special as SpecialResult["special"];
    return kind === "abandoned"
      ? { special: "abandoned" }
      : { special: kind, winner: raw.winner as "home" | "away" };
  }
  if (profile === "simple")
    return { home: raw.home as number, away: raw.away as number };
  if (profile === "sets") {
    const sets = raw.sets as [number, number][];
    const { home, away } = countSets(sets);
    return { sets, home, away };
  }
  return { winner: raw.winner as "home" | "away" };
}

function countSets(sets: [number, number][]): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const [h, a] of sets) {
    if (h > a) home++;
    else if (a > h) away++;
  }
  return { home, away };
}

// ---------- resolve (winner + display + magnitudes) ----------

export function resolve(
  profile: ScoringProfileKey,
  result: MatchResult,
  cfg?: ScoringConfig,
): Resolved {
  if (isSpecial(result)) {
    if (result.special === "abandoned")
      return { winner: "draw", display: "Avbrutt", homeScore: 0, awayScore: 0 };
    const w = result.winner ?? "home";
    const [hi, lo] = cfg?.walkoverScore ?? DEFAULT_WALKOVER;
    const label = result.special === "walkover" ? "W.O." : "Disk.";
    return {
      winner: w,
      display: label,
      homeScore: w === "home" ? hi : lo,
      awayScore: w === "away" ? hi : lo,
    };
  }

  if (profile === "simple") {
    const { home, away } = result as SimpleResult;
    return {
      winner: home > away ? "home" : away > home ? "away" : "draw",
      display: `${home}${EN_DASH}${away}`,
      homeScore: home,
      awayScore: away,
    };
  }

  if (profile === "sets") {
    const r = result as SetsResult;
    const setStr = r.sets.map(([h, a]) => `${h}${EN_DASH}${a}`).join(", ");
    return {
      winner: r.home > r.away ? "home" : r.away > r.home ? "away" : "draw",
      display: `${r.home}${EN_DASH}${r.away} (${setStr})`,
      homeScore: r.home, // sets won feed the tiebreak (set diff)
      awayScore: r.away,
    };
  }

  // winner
  const w = (result as WinnerResult).winner;
  return {
    winner: w,
    display: w === "home" ? "Hjemmelag vant" : "Bortelag vant",
    homeScore: w === "home" ? 1 : 0,
    awayScore: w === "away" ? 1 : 0,
  };
}

// ---------- league points ----------

export function leaguePoints(
  result: MatchResult,
  profile: ScoringProfileKey,
  cfg: ScoringConfig,
): LeaguePoints {
  if (isSpecial(result)) {
    if (result.special === "abandoned") return { home: 0, away: 0 };
    const w = result.winner ?? "home";
    return w === "home"
      ? { home: cfg.pointsWin, away: cfg.pointsLoss }
      : { home: cfg.pointsLoss, away: cfg.pointsWin };
  }
  const { winner } = resolve(profile, result);
  if (winner === "draw")
    return { home: cfg.pointsDraw, away: cfg.pointsDraw };
  if (winner === "home")
    return { home: cfg.pointsWin, away: cfg.pointsLoss };
  return { home: cfg.pointsLoss, away: cfg.pointsWin };
}

/** Whether a profile can ever produce a draw (drives wizard + table columns). */
export function profileAllowsDraw(
  profile: ScoringProfileKey,
  cfg: ScoringConfig,
): boolean {
  return profile === "simple" && cfg.allowDraw;
}

/** The default scoring config for a freshly-picked profile (wizard defaults). */
export function defaultScoringConfig(
  profile: ScoringProfileKey,
): ScoringConfig {
  return {
    profile,
    setsBestOf: profile === "sets" ? 5 : undefined,
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    allowDraw: profile === "simple",
  };
}
