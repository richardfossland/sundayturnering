import { ok, fail, readJson } from "@/lib/server/http";
import { authOrganiserOrAdmin } from "@/lib/server/auth";
import { db, bumpVersion } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import { computeTimer } from "@/lib/tournament/timer";

// POST /api/organiser/timer — board countdown. Authorised by EITHER the
// organiser code OR a signed-in admin who owns it.
//   action: 'start' (durationSec) | 'add' (+60s) | 'stop'
export async function POST(req: Request) {
  const body = await readJson<{
    tournamentId?: string;
    organiserCode?: string;
    action?: "start" | "add" | "stop";
    durationSec?: number;
  }>(req);
  const t = await authOrganiserOrAdmin(body?.tournamentId, body?.organiserCode);
  if (!t) return fail(403, "feil_arrangorkode");

  const timer = computeTimer(
    t.timer,
    body?.action ?? "start",
    Date.now(),
    body?.durationSec,
  );

  await db().from("tournaments").update({ timer }).eq("id", t.id);
  await bumpVersion(t.id);
  await broadcast(channels.tournament(t.id), events.structure, {});
  return ok({ timer });
}
