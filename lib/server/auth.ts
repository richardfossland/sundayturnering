import "server-only";

import { getTournament } from "@/lib/server/store";
import { normalizeWordCode } from "@/lib/codes";
import type { Tournament } from "@/lib/types";

/** Verify the organiser code for a tournament. Gates every destructive action
 * (advance to playoff, override result, re-seed, finish, delete). Referees with
 * only the control code can enter results but never reach these. */
export async function authOrganiser(
  tournamentId: unknown,
  organiserCode: unknown,
): Promise<Tournament | null> {
  if (typeof tournamentId !== "string" || typeof organiserCode !== "string")
    return null;
  const t = await getTournament(tournamentId);
  if (!t) return null;
  if (t.organiser_code !== normalizeWordCode(organiserCode)) return null;
  return t;
}
