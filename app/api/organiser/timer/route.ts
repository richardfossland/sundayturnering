import { ok, fail, readJson, organiserLimit, must, withApi } from "@/lib/server/http";
import { authOrganiserOrAdmin } from "@/lib/server/auth";
import { db, bumpVersion } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { computeTimer, isTimerAction } from "@/lib/tournament/timer";

// POST /api/organiser/timer — board countdown. Authorised by EITHER the
// organiser code OR a signed-in admin who owns it.
//   action: 'start' (durationSec) | 'add' (+60s) | 'stop'
async function handlePOST(req: Request) {
  const limited = organiserLimit(req);
  if (limited) return limited;
  const body = await readJson<{
    tournamentId?: string;
    organiserCode?: string;
    action?: unknown;
    durationSec?: number;
  }>(req);
  const t = await authOrganiserOrAdmin(body?.tournamentId, body?.organiserCode, req);
  if (!t) return fail(403, "feil_arrangorkode");
  // Unknown actions used to fall through to «start» (a 10-minute countdown).
  if (body?.action !== undefined && !isTimerAction(body.action)) return fail(400, "ugyldig_handling");

  const timer = computeTimer(
    t.timer,
    isTimerAction(body?.action) ? body.action : "start",
    Date.now(),
    body?.durationSec,
  );

  must(await db().from("tournaments").update({ timer }).eq("id", t.id));
  await bumpVersion(t.id);
  defer(() => broadcast(channels.tournament(t.id), events.structure, {}), "timer");
  return ok({ timer });
}

export const POST = withApi(handlePOST);
