// Domain types — mirror the Postgres tables (spec §2). DB rows use snake_case;
// these are the shapes the service-role client reads/writes and the API serves.

export type Format = "league" | "league_playoff" | "cup" | "group_playoff";

/** Optional board countdown timer (spec extension). endsAt is an ISO instant. */
export interface TimerState {
  endsAt: string | null;
  durationSec: number;
  running: boolean;
}
export type ScoringProfileKey = "simple" | "sets" | "winner";
export type Parallelism = "sequential" | "parallel";
export type TournamentStatus = "setup" | "league" | "playoff" | "finished";
export type MatchPhase = "league" | "playoff";
export type MatchStatus = "scheduled" | "live" | "done" | "bye";

/** Scoring config persisted on the tournament (drives input UI + standings). */
export interface ScoringConfig {
  profile: ScoringProfileKey;
  setsBestOf?: number; // sets profile only, e.g. 3 or 5
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  allowDraw: boolean;
  /** Default scoreline credited to the winner of a walkover/DQ (feeds the
   * standings score diff). Optional; defaults to [1, 0]. */
  walkoverScore?: [number, number];
}

/** Structural config persisted on the tournament. */
export interface TournamentConfig {
  playoffSize: 0 | 2 | 4 | 8 | 16;
  roundRobinDouble: boolean;
  /** Add a bronze final (third-place match) to the knockout bracket. */
  thirdPlace?: boolean;
  /** group_playoff only: how many groups to split into. */
  groupCount?: number;
  /** group_playoff only: how many teams advance from each group. */
  advancePerGroup?: number;
}

// ---------- result jsonb shapes (spec §2 / §3) ----------
export interface SimpleResult {
  home: number;
  away: number;
}
export interface SetsResult {
  sets: [number, number][]; // [[25,20],[23,25],...]
  home: number; // sets won
  away: number;
}
export interface WinnerResult {
  winner: "home" | "away";
}
/** Non-standard outcomes a referee can record (spec extension). Discriminated by
 * the `special` key, which no other result shape carries.
 *   walkover        — a team failed to show; the other is awarded the win.
 *   disqualification — a team is removed; the other is awarded the win.
 *   abandoned       — the match was annulled; voided (no points, not counted). */
export type SpecialKind = "walkover" | "disqualification" | "abandoned";
export interface SpecialResult {
  special: SpecialKind;
  winner?: "home" | "away"; // required for walkover/DQ; absent for abandoned
}
export type MatchResult =
  | SimpleResult
  | SetsResult
  | WinnerResult
  | SpecialResult;

// ---------- table rows ----------
export interface Tournament {
  id: string;
  control_code: string;
  board_code: string;
  organiser_code: string;
  organiser_id: string | null;
  title: string;
  sport_label: string;
  format: Format;
  scoring: ScoringConfig;
  parallelism: Parallelism;
  config: TournamentConfig;
  status: TournamentStatus;
  version: number;
  timer: TimerState | null;
  created_at: string;
}

export interface Court {
  id: string;
  tournament_id: string;
  name: string;
  sort_order: number;
  /** Optional per-court countdown (parallel mode); sequential reuses the
   * tournament-level timer. Null when no clock is running. */
  timer: TimerState | null;
}

export interface Team {
  id: string;
  tournament_id: string;
  name: string;
  colour: string;
  logo_url: string | null;
  seed: number | null;
  sort_order: number;
  members: string[];
  /** group_playoff: which group this team belongs to (0-based). Null otherwise. */
  group_no: number | null;
}

export interface Match {
  id: string;
  tournament_id: string;
  phase: MatchPhase;
  round: number;
  bracket_slot: number | null;
  /** group_playoff: which group this league match belongs to. Null otherwise. */
  group_no: number | null;
  court_id: string | null;
  queue_order: number;
  home_team_id: string | null;
  away_team_id: string | null; // null = bye / TBD
  status: MatchStatus;
  result: MatchResult | null;
  winner_team_id: string | null;
  locked_by: string | null;
  /** Device that saved the current result (`deviceId|deviceName`). Drives the
   * referee self-correct grace window. Null until a result is recorded. */
  result_by: string | null;
  result_version: number;
  updated_at: string;
}

export interface BracketLink {
  id: string;
  tournament_id: string;
  from_match_id: string;
  to_match_id: string;
  to_slot: "home" | "away";
  /** 'winner' carries the match winner onward; 'loser' feeds the bronze final. */
  feed: "winner" | "loser";
}

// ---------- derived (computed, not stored) ----------
export interface StandingRow {
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  scoreFor: number; // goals/points scored (simple) or sets won (sets)
  scoreAgainst: number;
  diff: number; // scoreFor - scoreAgainst
  rank: number;
  inPlayoff: boolean; // above the top-N cut line
  form?: ("W" | "D" | "L")[]; // last few league results, oldest → newest
}
