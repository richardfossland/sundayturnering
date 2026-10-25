import { ok, fail, readJson, rateLimit, ipKey, must, withApi } from "@/lib/server/http";
import { db, getMatch, getTournament } from "@/lib/server/store";
import { checkControlCode, prefetchBlocked } from "@/lib/server/auth";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
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
async function handlePOST(req: Request) {
  if (!rateLimit(`match-lock:${ipKey(req)}`, 1200, 60_000))
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
  const blocked = prefetchBlocked(req, m.tournament_id);
  const t = await getTournament(m.tournament_id).catch((e) => {
    blocked?.catch(() => {});
    throw e;
  });
  if (!t) return fail(404, "finnes_ikke");
  if (!(await checkControlCode(req, t, body.controlCode, blocked))) return fail(403, "feil_kontrollkode");
  if (m.status === "done" || m.status === "bye")
    return fail(409, "kamp_ferdig");

  const action = body.action ?? "lock";
  // A finished tournament takes no new play; releasing a stale lock is fine.
  if (t.status === "finished" && action !== "unlock")
    return fail(409, "turnering_avsluttet");
  if (m.phase === "league" && t.status === "playoff" && action !== "unlock")
    return fail(409, "serien_avsluttet");
  const tag = body.deviceName
    ? `${body.deviceId}|${body.deviceName}`
    : body.deviceId;

  // True when THIS call moved the match scheduled → live; the client echoes it
  // back as `revert` on unlock so only a lock-induced live is undone.
  let promoted = false;

  if (action === "start") {
    // Go live without taking an edit lock (others can still register the result).
    if (m.status === "scheduled")
      must(await db().from("matches").update({ status: "live" }).eq("id", m.id));
  } else if (action === "unlock") {
    if (m.locked_by && m.locked_by.split("|")[0] !== body.deviceId)
      return ok({ match: m }); // not our lock; ignore
    const demote = body.revert === true && m.status === "live";
    must(await db()
      .from("matches")
      // A demoted match also drops any interim live score it was showing.
      .update(demote ? { locked_by: null, status: "scheduled", result: null } : { locked_by: null })
      .eq("id", m.id));
  } else {
    // lock / force
    if (
      action === "lock" &&
      m.locked_by &&
      m.locked_by.split("|")[0] !== body.deviceId
    )
      return fail(409, "laast_av_annen", { lockedBy: m.locked_by });
    // `force` takes over unconditionally; `lock` is a compare-and-set on what we
    // last read: two devices racing for a free (or their own) lock → exactly one
    // UPDATE matches. On a miss, re-read: the holder may have released in the
    // meantime (null or ours) — retry once on the fresh row before answering
    // "locked by another".
    let cur = m;
    for (let attempt = 0; ; attempt++) {
      promoted = cur.status === "scheduled";
      let q = db()
        .from("matches")
        .update({ locked_by: tag, status: promoted ? "live" : cur.status })
        .eq("id", cur.id);
      if (action === "lock") {
        q = (cur.locked_by ? q.eq("locked_by", cur.locked_by) : q.is("locked_by", null))
          .eq("status", cur.status);
      }
      const won = must<{ id: string }[]>(await q.select("id"));
      if (action !== "lock" || (won && won.length > 0)) break;
      const now = await getMatch(m.id);
      if (!now) return fail(404, "finnes_ikke");
      if (now.status === "done" || now.status === "bye") return fail(409, "kamp_ferdig");
      const free = !now.locked_by || now.locked_by.split("|")[0] === body.deviceId;
      if (attempt >= 1 || !free) return fail(409, "laast_av_annen", { lockedBy: now.locked_by });
      cur = now;
    }
  }

  defer(() => broadcast(channels.tournament(m.tournament_id), events.lockChanged, {
    matchId: m.id,
  }), "lock");
  const updated = await getMatch(m.id);
  return ok({ match: updated, promoted });
}

export const POST = withApi(handlePOST);
