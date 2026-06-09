import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { computeStandings } from "@/lib/tournament/standings";
import { toTournamentDTO, type StateDTO } from "@/lib/dto";
import type { Court, Match, Team, Tournament } from "@/lib/types";

// Thin service-role data access. Every API route reads/writes through here so
// the RLS-bypassing client is never imported into UI code.

export function db() {
  return createServiceClient();
}

export async function getTournament(id: string): Promise<Tournament | null> {
  const { data } = await db()
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Tournament) ?? null;
}

export async function getTournamentByControlCode(
  code: string,
): Promise<Tournament | null> {
  const { data } = await db()
    .from("tournaments")
    .select("*")
    .eq("control_code", code)
    .maybeSingle();
  return (data as Tournament) ?? null;
}

export async function getTournamentByBoardCode(
  code: string,
): Promise<Tournament | null> {
  const { data } = await db()
    .from("tournaments")
    .select("*")
    .eq("board_code", code)
    .maybeSingle();
  return (data as Tournament) ?? null;
}

export async function getTeams(tournamentId: string): Promise<Team[]> {
  const { data } = await db()
    .from("teams")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("sort_order", { ascending: true });
  return (data as Team[]) ?? [];
}

export async function getCourts(tournamentId: string): Promise<Court[]> {
  const { data } = await db()
    .from("courts")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("sort_order", { ascending: true });
  return (data as Court[]) ?? [];
}

export async function getMatches(tournamentId: string): Promise<Match[]> {
  const { data } = await db()
    .from("matches")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("queue_order", { ascending: true });
  return (data as Match[]) ?? [];
}

export async function getMatch(id: string): Promise<Match | null> {
  const { data } = await db()
    .from("matches")
    .select("*")
    .eq("id", id)
    .maybeSingle();
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
  return { tournament: toTournamentDTO(t), teams, courts, matches, standings };
}

/** Bump the structural version (board cache-busting + structure broadcast). */
export async function bumpVersion(tournamentId: string): Promise<void> {
  const t = await getTournament(tournamentId);
  if (!t) return;
  await db()
    .from("tournaments")
    .update({ version: t.version + 1 })
    .eq("id", tournamentId);
}
