import "server-only";

import { getTournament } from "@/lib/server/store";
import { normalizeWordCode } from "@/lib/codes";
import { createAuthClient } from "@/lib/supabase/auth-server";
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

// ---------------------------------------------------------------------------
// Sunday Account admin layer (NEW). Anonymous code-gated play is untouched: an
// organiser code still authorises everything below via authOrganiserOrAdmin.
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

export interface AdminUser {
  id: string;
  email: string;
}

/** The ONE place authorisation policy lives. An admin is any signed-in Sunday
 * Account whose email is on the TURNERING_ADMIN_EMAILS allowlist (comma- or
 * whitespace-separated, case-insensitive). Keeping this isolated means there is
 * exactly one rule to audit. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allow = (process.env.TURNERING_ADMIN_EMAILS ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.trim().toLowerCase());
}

/** Resolve the signed-in admin from the Sunday Account session cookie. Throws
 * 401 when no session, 403 when the signed-in user is not on the allowlist.
 * Identity comes from the AUTH client (issuer project); authorisation is the
 * email allowlist above — NEVER taken from a request body. */
export async function requireAdmin(): Promise<AdminUser> {
  const supabase = await createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AuthError(401, "ikke_innlogget");
  const email = user.email ?? null;
  if (!isAdminEmail(email)) throw new AuthError(403, "ikke_admin");
  return { id: user.id, email: email! };
}

/** Resolve the current signed-in admin if there is one, else null. Used by the
 * create route to stamp organiser_id without ever rejecting anonymous play. */
export async function getOptionalAdmin(): Promise<AdminUser | null> {
  try {
    return await requireAdmin();
  } catch {
    return null;
  }
}

/** Admin + ownership: the signed-in admin must own the tournament
 * (organiser_id === userId). Throws 404 if it doesn't exist, 403 if owned by
 * someone else (or anonymous, organiser_id null). Returns the tournament. */
export async function requireOwnedTournament(id: unknown): Promise<{
  user: AdminUser;
  tournament: Tournament;
}> {
  if (typeof id !== "string") throw new AuthError(400, "ugyldig_id");
  const user = await requireAdmin();
  const t = await getTournament(id);
  if (!t) throw new AuthError(404, "finnes_ikke");
  if (t.organiser_id !== user.id) throw new AuthError(403, "ikke_eier");
  return { user, tournament: t };
}

/** Dual-path authorisation for the existing organiser actions (advance /
 * finish / override / timer). An action is permitted if EITHER:
 *   - the caller is a signed-in admin who owns the tournament, OR
 *   - the caller presents the correct organiser code (legacy anonymous path).
 * Tries the admin path first (so a logged-in owner needs no code), then falls
 * back to the organiser code. Returns the tournament, or null if neither
 * succeeds. `id` is the tournament id; `code` the organiser code from the body. */
export async function authOrganiserOrAdmin(
  id: unknown,
  code: unknown,
): Promise<Tournament | null> {
  if (typeof id === "string") {
    try {
      const { tournament } = await requireOwnedTournament(id);
      return tournament;
    } catch {
      // Not a signed-in owner — fall through to the organiser-code path so
      // anonymous, code-only organising keeps working exactly as before.
    }
  }
  return authOrganiser(id, code);
}

/** Uniform catch → Response for API routes. Returns null for non-auth errors so
 * the caller can rethrow / log them. */
export function authFail(err: unknown): Response | null {
  if (err instanceof AuthError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}
