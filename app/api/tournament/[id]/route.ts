import { ok, fail, isUuid } from "@/lib/server/http";
import { getTournament, getState, db } from "@/lib/server/store";
import { requireOwnedTournament, authFail } from "@/lib/server/auth";

// GET /api/tournament/[id] — full state for board + control to render.
// ANONYMOUS, unchanged: any device with the id can read the public state.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // A malformed id (slug, empty, SQL-ish input) can never match a row — reject
  // it before spending a PostgREST round-trip. Same outcome (404) as "no such
  // tournament" so this stays indistinguishable from a real miss.
  if (!isUuid(id)) return fail(404, "finnes_ikke");
  const t = await getTournament(id);
  if (!t) return fail(404, "finnes_ikke");
  const state = await getState(t);
  return ok(state, {
    headers: { "Cache-Control": "no-store" },
  });
}

// DELETE /api/tournament/[id] — remove a tournament. Admin-only and ownership-
// gated: 401 without a session, 403 when the signed-in admin doesn't own it.
// The FK cascade (teams/courts/matches/bracket_links → on delete cascade) cleans
// up children. There is NO organiser-code fallback here on purpose — deletion is
// destructive and only the Sunday Account owner may do it.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Same short-circuit as GET, but 400: a DELETE with a malformed id is a
  // caller bug (a real miss is 404, via requireOwnedTournament below), and
  // matches the existing `ugyldig_id` code requireOwnedTournament already
  // uses for a non-string id.
  if (!isUuid(id)) return fail(400, "ugyldig_id");
  try {
    await requireOwnedTournament(id);
    await db().from("tournaments").delete().eq("id", id);
    return ok({ ok: true });
  } catch (err) {
    const r = authFail(err);
    if (r) return r;
    console.error("[delete tournament]", err);
    return fail(500, "kunne_ikke_slette");
  }
}
