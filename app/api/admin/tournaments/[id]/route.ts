import { ok, fail, readJson } from "@/lib/server/http";
import { requireOwnedTournament, authFail } from "@/lib/server/auth";
import { db, bumpVersion } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";

// PATCH /api/admin/tournaments/[id] — edit a tournament's display fields
// (title / sport_label). Admin-owner gated. Structural edits (format, teams,
// schedule) are intentionally out of scope — they'd require re-building the
// bracket and risk corrupting an in-progress event.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { tournament } = await requireOwnedTournament(id);
    const body = await readJson<{ title?: unknown; sport_label?: unknown }>(req);
    if (!body) return fail(400, "ugyldig_body");

    const patch: { title?: string; sport_label?: string } = {};
    if (typeof body.title === "string")
      patch.title = body.title.trim().slice(0, 80);
    if (typeof body.sport_label === "string")
      patch.sport_label = body.sport_label.trim().slice(0, 40);
    if (Object.keys(patch).length === 0) return fail(400, "ingen_endring");

    await db().from("tournaments").update(patch).eq("id", tournament.id);
    await bumpVersion(tournament.id);
    await broadcast(channels.tournament(tournament.id), events.structure, {});
    return ok({ ok: true });
  } catch (err) {
    const r = authFail(err);
    if (r) return r;
    console.error("[admin patch tournament]", err);
    return fail(500, "kunne_ikke_endre");
  }
}
