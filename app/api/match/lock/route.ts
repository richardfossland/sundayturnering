import { ok, fail, readJson } from "@/lib/server/http";
import { db, getMatch } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";

// POST /api/match/lock — soft lock for editing (spec §4.1). action:
//   'lock'   set locked_by = deviceId; scheduled → live
//   'force'  take an existing lock
//   'unlock' clear lock; live → scheduled (unless already done)
export async function POST(req: Request) {
  const body = await readJson<{
    matchId?: string;
    deviceId?: string;
    deviceName?: string;
    action?: "lock" | "force" | "unlock";
  }>(req);
  if (!body?.matchId || !body.deviceId)
    return fail(400, "mangler_felt");

  const m = await getMatch(body.matchId);
  if (!m) return fail(404, "finnes_ikke");
  if (m.status === "done" || m.status === "bye")
    return fail(409, "kamp_ferdig");

  const action = body.action ?? "lock";
  const tag = body.deviceName
    ? `${body.deviceId}|${body.deviceName}`
    : body.deviceId;

  if (action === "unlock") {
    if (m.locked_by && m.locked_by.split("|")[0] !== body.deviceId)
      return ok({ match: m }); // not our lock; ignore
    await db()
      .from("matches")
      .update({ locked_by: null, status: m.status === "live" ? "scheduled" : m.status })
      .eq("id", m.id);
  } else {
    // lock / force
    if (
      action === "lock" &&
      m.locked_by &&
      m.locked_by.split("|")[0] !== body.deviceId
    )
      return fail(409, "laast_av_annen", { lockedBy: m.locked_by });
    await db()
      .from("matches")
      .update({ locked_by: tag, status: m.status === "scheduled" ? "live" : m.status })
      .eq("id", m.id);
  }

  await broadcast(channels.tournament(m.tournament_id), events.lockChanged, {
    matchId: m.id,
  });
  const updated = await getMatch(m.id);
  return ok({ match: updated });
}
