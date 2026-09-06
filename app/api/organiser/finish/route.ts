import { ok, fail, readJson } from "@/lib/server/http";
import { authOrganiserOrAdmin } from "@/lib/server/auth";
import { db, bumpVersion } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";

// POST /api/organiser/finish — mark the tournament finished (champion screen).
// Authorised by EITHER the organiser code OR a signed-in admin who owns it.
export async function POST(req: Request) {
  const body = await readJson<{ tournamentId?: string; organiserCode?: string }>(
    req,
  );
  const t = await authOrganiserOrAdmin(body?.tournamentId, body?.organiserCode);
  if (!t) return fail(403, "feil_arrangorkode");

  await db().from("tournaments").update({ status: "finished" }).eq("id", t.id);
  await bumpVersion(t.id);
  defer(() => broadcast(channels.tournament(t.id), events.structure, {}), "finish");
  return ok({ ok: true });
}
