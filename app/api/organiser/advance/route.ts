import { ok, fail, readJson } from "@/lib/server/http";
import { authOrganiserOrAdmin } from "@/lib/server/auth";
import { advanceToPlayoff } from "@/lib/server/playoff";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";

// POST /api/organiser/advance — build the playoff bracket from league standings.
// Authorised by EITHER the organiser code OR a signed-in admin who owns it
// (spec §5: stop a referee from nuking the bracket).
export async function POST(req: Request) {
  const body = await readJson<{ tournamentId?: string; organiserCode?: string }>(
    req,
  );
  const t = await authOrganiserOrAdmin(body?.tournamentId, body?.organiserCode);
  if (!t) return fail(403, "feil_arrangorkode");
  if (t.format !== "league_playoff" && t.format !== "group_playoff")
    return fail(400, "ikke_sluttspillformat");
  if (t.status === "playoff" || t.status === "finished")
    return fail(409, "allerede_avansert");

  try {
    await advanceToPlayoff(t);
  } catch (e) {
    return fail(400, "kunne_ikke_avansere", {
      detail: (e as Error).message,
    });
  }
  await broadcast(channels.tournament(t.id), events.structure, {});
  return ok({ ok: true });
}
