// Public DTOs — the shapes the GET endpoints serve to board + control clients.
// The state endpoint is ANONYMOUS (the /se and /live follow links read it), so
// the tournament summary carries NO codes at all: control_code is the referee
// credential for every write route, and serving it here let anyone holding a
// follow link enter results. Codes only travel back from /api/attach, to a
// device that has just proved one. organiser_code never leaves the server.

import type {
  Court,
  Match,
  StandingRow,
  Team,
  Tournament,
} from "@/lib/types";

/** Tournament summary safe to send to ANY viewer (spectators included). */
export interface TournamentDTO {
  id: string;
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

/** What /api/attach returns to a device that just proved a code. A referee
 * (control code) gets the control code back; a board (board code) gets both,
 * because the board's codes overlay shows the referee QR and the board code. */
export interface AttachedTournamentDTO extends TournamentDTO {
  control_code: string;
  board_code?: string;
}

export function toAttachedTournamentDTO(
  t: Tournament,
  via: "control" | "board",
): AttachedTournamentDTO {
  return {
    ...toTournamentDTO(t),
    control_code: t.control_code,
    ...(via === "board" ? { board_code: t.board_code } : {}),
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
