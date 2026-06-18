import { ok, fail } from "@/lib/server/http";
import { requireOwnedTournament, authFail } from "@/lib/server/auth";
import { db, bumpVersion, getMatches } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";

// POST /api/admin/tournaments/[id]/reopen — un-finish a tournament so the
// organiser can correct a result after the champion screen showed. Admin-owner
// gated. The prior phase is "playoff" if a knockout was ever built (any
// playoff-phase match exists), otherwise "league". Only acts on a finished
// tournament; bumps the version + broadcasts a structure refetch so every board
// leaves the champion screen.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { tournament } = await requireOwnedTournament(id);
    if (tournament.status !== "finished")
      return fail(409, "ikke_avsluttet");

    const matches = await getMatches(tournament.id);
    const hasPlayoff = matches.some((m) => m.phase === "playoff");
    const priorStatus = hasPlayoff ? "playoff" : "league";

    await db()
      .from("tournaments")
      .update({ status: priorStatus })
      .eq("id", tournament.id)
      .eq("status", "finished"); // guard against a concurrent reopen
    await bumpVersion(tournament.id);
    await broadcast(channels.tournament(tournament.id), events.structure, {});
    return ok({ ok: true, status: priorStatus });
  } catch (err) {
    const r = authFail(err);
    if (r) return r;
    console.error("[admin reopen]", err);
    return fail(500, "kunne_ikke_gjenapne");
  }
}
