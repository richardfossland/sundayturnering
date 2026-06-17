// Public DTOs — the shapes the GET endpoints serve to board + control clients.
// Never includes organiser_code (that is a secret held only by the organiser
// device). control_code/board_code are on the tournament so the board can
// display them; control devices already know the control_code.

import type {
  Court,
  Match,
  StandingRow,
  Team,
  Tournament,
} from "@/lib/types";

/** Tournament summary safe to send to any attached device. */
export interface TournamentDTO {
  id: string;
  control_code: string;
  board_code: string;
  title: string;
  sport_label: string;
  format: Tournament["format"];
  scoring: Tournament["scoring"];
  parallelism: Tournament["parallelism"];
  config: Tournament["config"];
  status: Tournament["status"];
  version: number;
  timer: Tournament["timer"];
}

export function toTournamentDTO(t: Tournament): TournamentDTO {
  return {
    id: t.id,
    control_code: t.control_code,
    board_code: t.board_code,
    title: t.title,
    sport_label: t.sport_label,
    format: t.format,
    scoring: t.scoring,
    parallelism: t.parallelism,
    config: t.config,
    status: t.status,
    version: t.version,
    timer: t.timer ?? null,
  };
}

/** The full state a board or control device renders. One fetch, everything. */
export interface StateDTO {
  tournament: TournamentDTO;
  teams: Team[];
  courts: Court[];
  matches: Match[];
  standings: StandingRow[];
  /** Per-group tables, present only for the group_playoff format. */
  groupStandings?: { group_no: number; rows: StandingRow[] }[];
}
