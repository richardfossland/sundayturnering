import { ok, fail, readJson, rateLimit, clientIp, must, withApi } from "@/lib/server/http";
import { db, getTournament, bumpVersion } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { computeTimer } from "@/lib/tournament/timer";
import { checkControlCode } from "@/lib/server/auth";
import type { TimerState } from "@/lib/types";

// POST /api/match/timer — referee-controlled countdown shown on the board. This
// is non-destructive (no result/structure mutation), so it is NOT organiser-
// gated, mirroring /api/match/lock — but like every referee route it requires
// the control code. Per-court in parallel mode (courtId given),
// tournament-level in sequential mode.
//   action: 'start' (durationSec) | 'add' (+60s) | 'stop'
const CONFLICT = Symbol("conflict");

async function readTimer(
  table: "courts" | "tournaments",
  id: string,
): Promise<TimerState | null> {
  const row = must<{ timer: TimerState | null } | null>(
    await db().from(table).select("timer").eq("id", id).maybeSingle(),
  );
  return row?.timer ?? null;
}

/** Start/stop overwrite. `add` is read-modify-write, so it is a compare-and-set
 * on the old endsAt: two referees tapping +1:00 at once can't both write from
 * the same base (one would silently lose a minute). On a miss, re-read and
 * retry once; still losing → CONFLICT (409). */
async function writeTimer(
  table: "courts" | "tournaments",
  id: string,
  current: TimerState | null,
  reread: () => Promise<TimerState | null>,
  action: "start" | "add" | "stop",
  durationSec: number | undefined,
): Promise<TimerState | null | typeof CONFLICT> {
  if (action !== "add") {
    const timer = computeTimer(current, action, Date.now(), durationSec);
    must(await db().from(table).update({ timer }).eq("id", id));
    return timer;
  }
  let prev = current;
  for (let attempt = 0; attempt < 2; attempt++) {
    const timer = computeTimer(prev, "add", Date.now(), durationSec);
    let q = db().from(table).update({ timer }).eq("id", id);
    if (!prev) q = q.is("timer", null);
    else if (typeof prev.endsAt === "string") q = q.eq("timer->>endsAt", prev.endsAt);
    else q = q.is("timer->>endsAt", null);
    const won = must<{ id: string }[]>(await q.select("id"));
    if (won && won.length > 0) return timer;
    prev = await reread();
  }
  return CONFLICT;
}

async function handlePOST(req: Request) {
  if (!rateLimit(`mtimer:${clientIp(req)}`, 600, 60_000))
    return fail(429, "for_mange_forsok");

  const body = await readJson<{
    tournamentId?: string;
    courtId?: string;
    action?: "start" | "add" | "stop";
    durationSec?: number;
    controlCode?: string;
  }>(req);
  if (!body?.tournamentId) return fail(400, "mangler_felt");

  const t = await getTournament(body.tournamentId);
  if (!t) return fail(404, "finnes_ikke");
  // Referee credential: the control code. The tournament id is in every
  // public follow link, so it must not be enough to drive the board's clock.
  if (!(await checkControlCode(req, t, body.controlCode))) return fail(403, "feil_kontrollkode");
  if (t.status === "finished") return fail(409, "turnering_avsluttet");

  const action = body.action ?? "start";

  if (body.courtId) {
    // Parallel mode: verify the court belongs to this tournament (ungated route).
    const court = must<{ id: string; timer: unknown; tournament_id: string } | null>(
      await db()
        .from("courts")
        .select("id, timer, tournament_id")
        .eq("id", body.courtId)
        .maybeSingle(),
    );
    if (!court || court.tournament_id !== t.id)
      return fail(404, "bane_finnes_ikke");

    const courtId = body.courtId;
    const timer = await writeTimer(
      "courts",
      courtId,
      (court.timer as TimerState | null) ?? null,
      () => readTimer("courts", courtId),
      action,
      body.durationSec,
    );
    if (timer === CONFLICT) return fail(409, "konflikt");
    await bumpVersion(t.id);
    defer(() => broadcast(channels.tournament(t.id), events.structure, {}), "match-timer");
    return ok({ timer });
  }

  // Sequential mode: reuse the tournament-level timer.
  const timer = await writeTimer(
    "tournaments",
    t.id,
    t.timer,
    () => readTimer("tournaments", t.id),
    action,
    body.durationSec,
  );
  if (timer === CONFLICT) return fail(409, "konflikt");
  await bumpVersion(t.id);
  defer(() => broadcast(channels.tournament(t.id), events.structure, {}), "match-timer");
  return ok({ timer });
}

export const POST = withApi(handlePOST);
