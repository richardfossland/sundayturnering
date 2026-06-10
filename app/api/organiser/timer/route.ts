import { ok, fail, readJson } from "@/lib/server/http";
import { authOrganiser } from "@/lib/server/auth";
import { db, bumpVersion } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import type { TimerState } from "@/lib/types";

// POST /api/organiser/timer — board countdown. Organiser-code gated.
//   action: 'start' (durationSec) | 'add' (+60s) | 'stop'
export async function POST(req: Request) {
  const body = await readJson<{
    tournamentId?: string;
    organiserCode?: string;
    action?: "start" | "add" | "stop";
    durationSec?: number;
  }>(req);
  const t = await authOrganiser(body?.tournamentId, body?.organiserCode);
  if (!t) return fail(403, "feil_arrangorkode");

  const now = Date.now();
  let timer: TimerState | null;
  if (body?.action === "stop") {
    timer = null;
  } else if (body?.action === "add") {
    const cur = t.timer;
    const parsed = cur?.endsAt ? Date.parse(cur.endsAt) : NaN;
    // Guard a malformed/absent endsAt (Date.parse → NaN would crash toISOString);
    // "add" with no running timer just starts a default 5-minute clock.
    const running = cur?.running && Number.isFinite(parsed);
    const base = running ? Math.max(now, parsed) : now;
    timer = {
      endsAt: new Date(base + 60_000).toISOString(),
      durationSec: (running ? (cur!.durationSec ?? 0) : 240) + 60,
      running: true,
    };
  } else {
    const dur = Math.max(10, Math.min(7200, Math.floor(body?.durationSec ?? 600)));
    timer = { endsAt: new Date(now + dur * 1000).toISOString(), durationSec: dur, running: true };
  }

  await db().from("tournaments").update({ timer }).eq("id", t.id);
  await bumpVersion(t.id);
  await broadcast(channels.tournament(t.id), events.structure, {});
  return ok({ timer });
}
