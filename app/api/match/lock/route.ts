import { ok, fail, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { db, getMatch, getTournament } from "@/lib/server/store";
import { authControlCode } from "@/lib/server/auth";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";

// POST /api/match/lock — soft lock for editing (spec §4.1). action:
//   'lock'   set locked_by = deviceId; scheduled → live (response: promoted)
//   'force'  take an existing lock
//   'unlock' clear lock; live → scheduled ONLY when the caller says `revert`
//            (it was this lock that promoted the match — see below)
//   'start'  mark scheduled → live WITHOUT holding a lock (referee "Start kamp")
//
// Why `revert` is explicit: a match started with "Start kamp" is live on the
// board. A referee who then opens the result modal (lock) and closes it again
// (unlock) used to demote it back to scheduled — the match vanished from "Nå
// spiller". Only the device whose lock did the promoting knows that, so it
// tells us on release; the server never guesses.
export async function POST(req: Request) {
  if (!rateLimit(`match-lock:${clientIp(req)}`, 120, 60_000))
    return fail(429, "for_mange_forsok");
  const body = await readJson<{
    matchId?: string;
    deviceId?: string;
    deviceName?: string;
    action?: "lock" | "force" | "unlock" | "start";
    controlCode?: string;
    revert?: boolean;
  }>(req);
  if (!body?.matchId || !body.deviceId)
    return fail(400, "mangler_felt");

  const m = await getMatch(body.matchId);
  if (!m) return fail(404, "finnes_ikke");
  // Referee credential: the control code. Match ids alone are public.
  const t = await getTournament(m.tournament_id);
  if (!t) return fail(404, "finnes_ikke");
  if (!authControlCode(t, body.controlCode)) return fail(403, "feil_kontrollkode");
  if (m.status === "done" || m.status === "bye")
    return fail(409, "kamp_ferdig");

  const action = body.action ?? "lock";
  const tag = body.deviceName
    ? `${body.deviceId}|${body.deviceName}`
    : body.deviceId;

  // True when THIS call moved the match scheduled → live; the client echoes it
  // back as `revert` on unlock so only a lock-induced live is undone.
  let promoted = false;

  if (action === "start") {
    // Go live without taking an edit lock (others can still register the result).
    if (m.status === "scheduled")
      await db().from("matches").update({ status: "live" }).eq("id", m.id);
  } else if (action === "unlock") {
    if (m.locked_by && m.locked_by.split("|")[0] !== body.deviceId)
      return ok({ match: m }); // not our lock; ignore
    const demote = body.revert === true && m.status === "live";
    await db()
      .from("matches")
      .update(demote ? { locked_by: null, status: "scheduled" } : { locked_by: null })
      .eq("id", m.id);
  } else {
    // lock / force
    if (
      action === "lock" &&
      m.locked_by &&
      m.locked_by.split("|")[0] !== body.deviceId
    )
      return fail(409, "laast_av_annen", { lockedBy: m.locked_by });
    promoted = m.status === "scheduled";
    await db()
      .from("matches")
      .update({ locked_by: tag, status: promoted ? "live" : m.status })
      .eq("id", m.id);
  }

  await broadcast(channels.tournament(m.tournament_id), events.lockChanged, {
    matchId: m.id,
  });
  const updated = await getMatch(m.id);
  return ok({ match: updated, promoted });
}
