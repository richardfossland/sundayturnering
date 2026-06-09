import { ok, fail, readJson } from "@/lib/server/http";
import { authOrganiser } from "@/lib/server/auth";
import { db, bumpVersion } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";

// POST /api/organiser/finish — mark the tournament finished (champion screen).
// Organiser-code gated.
export async function POST(req: Request) {
  const body = await readJson<{ tournamentId?: string; organiserCode?: string }>(
    req,
  );
  const t = await authOrganiser(body?.tournamentId, body?.organiserCode);
  if (!t) return fail(403, "feil_arrangorkode");

  await db().from("tournaments").update({ status: "finished" }).eq("id", t.id);
  await bumpVersion(t.id);
  await broadcast(channels.tournament(t.id), events.structure, {});
  return ok({ ok: true });
}
