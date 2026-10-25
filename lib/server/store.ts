import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { computeStandings, computeGroupStandings } from "@/lib/tournament/standings";
import { toTournamentDTO, type StateDTO } from "@/lib/dto";
import type { Court, Match, Team, Tournament } from "@/lib/types";

// Thin service-role data access. Every API route reads/writes through here so
// the RLS-bypassing client is never imported into UI code.

export function db() {
  return createServiceClient();
}

export async function getTournament(id: string): Promise<Tournament | null> {
  const { data, error } = await db()
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Tournament) ?? null;
}

export async function getTournamentByControlCode(
  code: string,
): Promise<Tournament | null> {
  const { data, error } = await db()
    .from("tournaments")
    .select("*")
    .eq("control_code", code)
    .maybeSingle();
  if (error) throw error;
  return (data as Tournament) ?? null;
}

export async function getTournamentByBoardCode(
  code: string,
): Promise<Tournament | null> {
  // Older rows may share a board code (no unique constraint) — maybeSingle()
  // would error on the pair and resolve neither. Newest wins.
  const { data, error } = await db()
    .from("tournaments")
    .select("*")
    .eq("board_code", code)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data as Tournament[] | null)?.[0]) ?? null;
}

export async function getTeams(tournamentId: string): Promise<Team[]> {
  const { data, error } = await db()
    .from("teams")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data as Team[]) ?? [];
}

export async function getCourts(tournamentId: string): Promise<Court[]> {
  const { data, error } = await db()
    .from("courts")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data as Court[]) ?? [];
}

export async function getMatches(tournamentId: string): Promise<Match[]> {
  const { data, error } = await db()
    .from("matches")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("queue_order", { ascending: true });
  if (error) throw error;
  return (data as Match[]) ?? [];
}

export async function getMatch(id: string): Promise<Match | null> {
  const { data, error } = await db()
    .from("matches")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Match) ?? null;
}

/** Assemble the full state a board/control device renders, with standings
 * computed server-side from the active scoring profile. */
export async function getState(t: Tournament): Promise<StateDTO> {
  const [teams, courts, matches] = await Promise.all([
    getTeams(t.id),
    getCourts(t.id),
    getMatches(t.id),
  ]);
  const standings = computeStandings(
    teams,
    matches,
    t.scoring,
    t.config?.playoffSize ?? 0,
  );
  const groupStandings =
    t.format === "group_playoff"
      ? computeGroupStandings(
          teams,
          matches,
          t.scoring,
          t.config?.advancePerGroup ?? 2,
        )
      : undefined;
  return {
    tournament: toTournamentDTO(t),
    teams,
    courts,
    matches,
    standings,
    groupStandings,
  };
}

/** Bump the structural version (board cache-busting + structure broadcast).
 * Atomic increment via RPC so concurrent structural changes don't lose bumps. */
export async function bumpVersion(tournamentId: string): Promise<void> {
  const { error } = await db().rpc("bump_version", { p_id: tournamentId });
  if (error) throw error;
}

/** Lightweight row for the admin dashboard list (no standings/matches join —
 * just enough to render and link each card). Never includes organiser_code. */
export interface OrganiserTournamentRow {
  id: string;
  title: string;
  sport_label: string;
  format: Tournament["format"];
  status: Tournament["status"];
  control_code: string;
  board_code: string;
  created_at: string;
}

/** List tournaments owned by a signed-in admin (organiser_id === userId),
 * newest first. Used by GET /api/admin/tournaments. Anonymous tournaments
 * (organiser_id null) are never returned here. */
export async function listTournamentsByOrganiser(
  organiserId: string,
): Promise<OrganiserTournamentRow[]> {
  const { data, error } = await db()
    .from("tournaments")
    .select(
      "id, title, sport_label, format, status, control_code, board_code, created_at",
    )
    .eq("organiser_id", organiserId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as OrganiserTournamentRow[]) ?? [];
}
