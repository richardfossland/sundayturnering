import { ok, fail } from "@/lib/server/http";
import { requireAdmin, authFail } from "@/lib/server/auth";
import { listTournamentsByOrganiser } from "@/lib/server/store";

// GET /api/admin/tournaments — the signed-in admin's own tournaments
// (organiser_id === userId), newest first. Admin-session gated; never returns
// anonymous tournaments or organiser_code.
export async function GET() {
  try {
    const user = await requireAdmin();
    const tournaments = await listTournamentsByOrganiser(user.id);
    return ok({ tournaments });
  } catch (err) {
    const r = authFail(err);
    if (r) return r;
    console.error("[admin tournaments]", err);
    return fail(500, "kunne_ikke_hente");
  }
}
