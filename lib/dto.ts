// Public DTOs — the shapes the GET endpoints serve to board + control clients.
// The state endpoint is ANONYMOUS (the /se and /live follow links read it), so
// the tournament summary carries NO codes at all: control_code is the referee
// credential for every write route, and serving it here let anyone holding a
// follow link enter results. Codes only travel back from /api/attach, to a
// device that has just proved one. organiser_code never leaves the server.

import type {
  BracketLink,
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

/** A match as served to ANY viewer. The row holds `locked_by` / `result_by` as
 * `<device identity>|<name>`; the identity half must never leave the server —
 * result_by's tag is what authorises a referee self-correct, and a raw
 * locked_by deviceId let a bystander impersonate the lock holder. Only the
 * display name survives («Bane 1»), or null when there is nothing to show. */
export function toMatchDTO<T extends Match>(m: T): T {
  const name = (tag: string | null): string | null => {
    if (tag == null) return null;
    const i = tag.indexOf("|");
    return (i >= 0 ? tag.slice(i + 1) : "").trim() || null;
  };
  // precall_court_id (migration 0019) is internal bookkeeping for «Angre oppkalling».
  const { precall_court_id: _internal, ...rest } = m as T & { precall_court_id?: unknown };
  void _internal;
  return {
    ...(rest as T),
    // A lock with no name still needs a label in «Redigeres av …».
    locked_by: m.locked_by == null ? null : (name(m.locked_by) ?? "Enhet"),
    result_by: name(m.result_by),
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
  /** Brakettkoblinger (hvem mater hvem). Uten: storskjermen utleder dem fra runde/slot. */
  links?: Pick<BracketLink, "from_match_id" | "to_match_id" | "to_slot" | "feed">[];
}
