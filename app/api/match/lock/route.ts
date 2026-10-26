import { ok, fail, readJson, rateLimit, ipKey, must, withApi } from "@/lib/server/http";
import { db, getMatch, getTournament } from "@/lib/server/store";
import { checkControlCode, prefetchBlocked } from "@/lib/server/auth";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { toMatchDTO } from "@/lib/dto";

// POST /api/match/lock — soft lock for editing (spec §4.1). action:
//   'lock'   set locked_by = deviceId; scheduled/called → live (response: promoted)
//   'force'  take an existing lock
//   'unlock' clear lock; live → scheduled ONLY when the caller says `revert`
//            (it was this lock that promoted the match — see below)
//   'start'  mark scheduled/called → live WITHOUT holding a lock (referee "Start kamp")
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
  // Going live needs two known teams: a match still waiting for a bracket
  // feeder («Avventer») would go live and could never be finished.
  const teamsKnown = !!(m.home_team_id && m.away_team_id);
  if (action !== "unlock" && !teamsKnown && m.status !== "live")
    return fail(409, "kamp_ikke_klar");
  const tag = body.deviceName
    ? `${body.deviceId}|${body.deviceName}`
    : body.deviceId;

  // Every write below is a compare-and-set on the status (and lock) it READ:
  // a save that commits on the server while this request is in flight turns
  // the match `done`, and a blind write would put it back to live/scheduled
  // (and drop the result). A write that matches no row means the match moved
  // on; the answer is then built from a fresh read, never from the stale one.
  // True when THIS call moved the match scheduled/called → live; the client echoes it
  // back as `revert` on unlock so only a lock-induced live is undone.
  let promoted = false;

  if (action === "start") {
    // Go live without taking an edit lock (others can still register the result).
    if (m.status === "scheduled" || m.status === "called") {
      const won = must<{ id: string }[]>(
        await db()
          .from("matches")
          .update({ status: "live" })
          .eq("id", m.id)
          .in("status", ["scheduled", "called"])
          .select("id"),
      );
      if (!won || won.length === 0) {
        const now = await getMatch(m.id);
        if (!now) return fail(404, "finnes_ikke");
        if (now.status === "done" || now.status === "bye") return fail(409, "kamp_ferdig");
        // Already live (another phone pressed Start first): same end state.
      }
    }
  } else if (action === "unlock") {
    if (m.locked_by && m.locked_by.split("|")[0] !== body.deviceId)
      return ok({ match: toMatchDTO(m) }); // not our lock; ignore
    const demote = body.revert === true && m.status === "live";
    // A match that was CALLED before the lock lifted it to live (called_at is
    // kept by the promotion) goes back to «called», not to «scheduled».
    const wasCalled = demote && m.called_at != null;
    let q = db()
      .from("matches")
      // A demoted match also drops any interim live score it was showing.
      .update(
        demote
          ? wasCalled
            ? { locked_by: null, status: "called", result: null }
            : { locked_by: null, status: "scheduled", result: null, called_at: null }
          : { locked_by: null },
      )
      .eq("id", m.id);
    // Only OUR lock is cleared (someone may have force-taken it since the read),
    // and only a still-live match is demoted (it may have just been finished).
    q = m.locked_by ? q.eq("locked_by", m.locked_by) : q.is("locked_by", null);
    if (demote) q = q.eq("status", "live");
    must(await q.select("id"));
    // Zero rows = the match moved on; the fresh read below is the answer.
  } else {
    // lock / force: both are a compare-and-set on the status we read (a match
    // that became `done` must never go live again). `lock` additionally on the
    // lock holder: two devices racing for a free (or their own) lock → exactly
    // one UPDATE matches. On a miss, re-read: the holder may have released (or
    // the status may have changed) in the meantime — retry once on the fresh
    // row before answering. `force` takes the lock over whoever holds it.
    if (
      action === "lock" &&
      m.locked_by &&
      m.locked_by.split("|")[0] !== body.deviceId
    )
      return fail(409, "laast_av_annen", { lockedBy: toMatchDTO(m).locked_by });
    let cur = m;
    for (let attempt = 0; ; attempt++) {
      promoted = cur.status === "scheduled" || cur.status === "called";
      if (promoted && !(cur.home_team_id && cur.away_team_id))
        return fail(409, "kamp_ikke_klar");
      let q = db()
        .from("matches")
        .update({ locked_by: tag, status: promoted ? "live" : cur.status })
        .eq("id", cur.id)
        .eq("status", cur.status);
      if (action === "lock")
        q = cur.locked_by ? q.eq("locked_by", cur.locked_by) : q.is("locked_by", null);
      const won = must<{ id: string }[]>(await q.select("id"));
      if (won && won.length > 0) break;
      const now = await getMatch(m.id);
      if (!now) return fail(404, "finnes_ikke");
      if (now.status === "done" || now.status === "bye") return fail(409, "kamp_ferdig");
      const free = !now.locked_by || now.locked_by.split("|")[0] === body.deviceId;
      if (attempt >= 1) return fail(409, action === "lock" ? "laast_av_annen" : "konflikt", { lockedBy: toMatchDTO(now).locked_by });
      if (action === "lock" && !free) return fail(409, "laast_av_annen", { lockedBy: toMatchDTO(now).locked_by });
      cur = now;
    }
  }

  defer(() => broadcast(channels.tournament(m.tournament_id), events.lockChanged, {
    matchId: m.id,
  }), "lock");
  const updated = await getMatch(m.id);
  return ok({ match: updated ? toMatchDTO(updated) : updated, promoted });
}

export const POST = withApi(handlePOST);
