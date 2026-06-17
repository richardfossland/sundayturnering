import { ok, fail, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { db, getTournament, bumpVersion } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import { computeTimer } from "@/lib/tournament/timer";
import type { TimerState } from "@/lib/types";

// POST /api/match/timer — referee-controlled countdown shown on the board. This
// is non-destructive (no result/structure mutation), so it is NOT organiser-
// gated, mirroring /api/match/lock. Per-court in parallel mode (courtId given),
// tournament-level in sequential mode.
//   action: 'start' (durationSec) | 'add' (+60s) | 'stop'
export async function POST(req: Request) {
  if (!rateLimit(`mtimer:${clientIp(req)}`, 60, 60_000))
    return fail(429, "for_mange_forsok");

  const body = await readJson<{
    tournamentId?: string;
    courtId?: string;
    action?: "start" | "add" | "stop";
    durationSec?: number;
  }>(req);
  if (!body?.tournamentId) return fail(400, "mangler_felt");

  const t = await getTournament(body.tournamentId);
  if (!t) return fail(404, "finnes_ikke");

  const action = body.action ?? "start";

  if (body.courtId) {
    // Parallel mode: verify the court belongs to this tournament (ungated route).
    const { data: court } = await db()
      .from("courts")
      .select("id, timer, tournament_id")
      .eq("id", body.courtId)
      .maybeSingle();
    if (!court || court.tournament_id !== t.id)
      return fail(404, "bane_finnes_ikke");

    const timer = computeTimer(
      (court.timer as TimerState | null) ?? null,
      action,
      Date.now(),
      body.durationSec,
    );
    await db().from("courts").update({ timer }).eq("id", body.courtId);
    await bumpVersion(t.id);
    await broadcast(channels.tournament(t.id), events.structure, {});
    return ok({ timer });
  }

  // Sequential mode: reuse the tournament-level timer.
  const timer = computeTimer(t.timer, action, Date.now(), body.durationSec);
  await db().from("tournaments").update({ timer }).eq("id", t.id);
  await bumpVersion(t.id);
  await broadcast(channels.tournament(t.id), events.structure, {});
  return ok({ timer });
}
