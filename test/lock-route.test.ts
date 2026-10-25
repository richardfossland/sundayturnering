import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, Tournament } from "@/lib/types";

// The soft lock's status side effects. Regression pinned: a match started with
// "Start kamp" (live, no lock) was demoted to scheduled when a referee opened
// and closed the result modal, because unlock always reverted live → scheduled.
// Now only the device whose lock promoted the match reverts it (`revert`).

const ID = "11111111-1111-1111-1111-111111111111";
const MID = "22222222-2222-2222-2222-222222222222";
let matchRow: Match;
const patches: Record<string, unknown>[] = [];
const conditions: string[][] = [];
let raceLost = false;
let raceLosses = 0; // number of CAS attempts to lose, then win
let rereads: Match[] = []; // queued answers for getMatch after the first read

vi.mock("@/lib/server/store", () => ({
  getTournament: async (): Promise<Tournament> => ({
    id: ID,
    control_code: "402815",
    board_code: "KOLE-FR",
    organiser_code: "ABCD-EF",
    organiser_id: null,
    title: "T",
    sport_label: "",
    format: "league",
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: false },
    parallelism: "sequential",
    config: { playoffSize: 0, roundRobinDouble: false },
    status: "league",
    version: 0,
    timer: null,
    created_at: "",
  }),
  getMatch: async () => rereads.shift() ?? matchRow,
  db: () => ({
    rpc: async () => ({ data: false, error: null }),
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        patches.push(patch);
        const conds: string[] = [];
        const q: Record<string, unknown> = {
          eq: (col: string, v: unknown) => (conds.push(`eq:${col}:${v}`), q),
          is: (col: string, v: unknown) => (conds.push(`is:${col}:${v}`), q),
          select: async () => {
            conditions.push(conds);
            return { data: raceLost || raceLosses-- > 0 ? [] : [{ id: MID }], error: null };
          },
          then: (res: (v: unknown) => void) => res({ error: null }),
        };
        return q;
      },
    }),
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));

import { POST } from "@/app/api/match/lock/route";

function makeMatch(over: Partial<Match> = {}): Match {
  return {
    id: MID,
    tournament_id: ID,
    phase: "league",
    round: 1,
    bracket_slot: null,
    group_no: null,
    court_id: null,
    queue_order: 0, scheduled_at: null, called_at: null,
    home_team_id: "h",
    away_team_id: "a",
    status: "scheduled",
    result: null,
    winner_team_id: null,
    locked_by: null,
    result_by: null,
    result_version: 0,
    updated_at: "",
    ...over,
  };
}

async function lock(body: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost/api/match/lock", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": `10.1.0.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ matchId: MID, deviceId: "d1", deviceName: "Bane 1", controlCode: "402815", ...body }),
    }),
  );
  return { status: res.status, json: await res.json() };
}

describe("POST /api/match/lock — status side effects", () => {
  beforeEach(() => {
    patches.length = 0;
    conditions.length = 0;
    raceLost = false;
    raceLosses = 0;
    rereads = [];
  });

  it("lock on a scheduled match promotes it and reports promoted:true", async () => {
    matchRow = makeMatch();
    const r = await lock({ action: "lock" });
    expect(r.status).toBe(200);
    expect(r.json.promoted).toBe(true);
    expect(patches).toEqual([{ locked_by: "d1|Bane 1", status: "live" }]);
  });

  it("lock on an already-live match (started with Start kamp) reports promoted:false", async () => {
    matchRow = makeMatch({ status: "live" });
    const r = await lock({ action: "lock" });
    expect(r.json.promoted).toBe(false);
    expect(patches).toEqual([{ locked_by: "d1|Bane 1", status: "live" }]);
  });

  it("unlock WITH revert demotes the lock-promoted match back to scheduled", async () => {
    matchRow = makeMatch({ status: "live", locked_by: "d1|Bane 1" });
    await lock({ action: "unlock", revert: true });
    expect(patches).toEqual([{ locked_by: null, status: "scheduled", result: null, called_at: null }]);
  });

  it("unlock WITH revert of a previously CALLED match restores «called» and keeps called_at", async () => {
    matchRow = makeMatch({ status: "live", locked_by: "d1|Bane 1", called_at: "2026-10-25T10:00:00Z" });
    await lock({ action: "unlock", revert: true });
    expect(patches).toEqual([{ locked_by: null, status: "called", result: null }]);
  });

  it("unlock WITHOUT revert only releases the lock — a started match stays live", async () => {
    matchRow = makeMatch({ status: "live", locked_by: "d1|Bane 1" });
    await lock({ action: "unlock" });
    expect(patches).toEqual([{ locked_by: null }]);
  });

  it("unlock of someone else's lock is ignored", async () => {
    matchRow = makeMatch({ status: "live", locked_by: "other|X" });
    const r = await lock({ action: "unlock", revert: true });
    expect(r.status).toBe(200);
    expect(patches).toEqual([]);
  });

  it("start goes live without a lock", async () => {
    matchRow = makeMatch();
    await lock({ action: "start" });
    expect(patches).toEqual([{ status: "live" }]);
  });

  it("a CALLED match goes live on start and on lock (promoted:true)", async () => {
    matchRow = makeMatch({ status: "called" });
    await lock({ action: "start" });
    expect(patches).toEqual([{ status: "live" }]);
    patches.length = 0;
    const r = await lock({ action: "lock" });
    expect(r.json.promoted).toBe(true);
    expect(patches).toEqual([{ locked_by: "d1|Bane 1", status: "live" }]);
    expect(conditions[0]).toEqual(expect.arrayContaining(["eq:status:called"]));
  });

  it("lock is a compare-and-set on the free lock (is null) and current status", async () => {
    matchRow = makeMatch();
    await lock({ action: "lock" });
    expect(conditions[0]).toEqual(expect.arrayContaining([`eq:id:${MID}`, "is:locked_by:null", "eq:status:scheduled"]));
  });

  it("lock CAS on an existing own lock matches the old value", async () => {
    matchRow = makeMatch({ status: "live", locked_by: "d1|Gammel" });
    await lock({ action: "lock" });
    expect(conditions[0]).toContain("eq:locked_by:d1|Gammel");
  });

  it("race loser (0 rows updated) gets the same answer as 'already locked'", async () => {
    matchRow = makeMatch();
    raceLost = true;
    // by the time the loser re-reads, the winner holds the lock
    const r = await lock({ action: "lock" });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("laast_av_annen");
  });

  it("CAS miss, lock now free → retried once on the fresh row and wins", async () => {
    matchRow = makeMatch({ status: "live", locked_by: "d1|Gammel" });
    raceLosses = 1;
    rereads = [matchRow, makeMatch({ status: "live", locked_by: null })]; // 1st = initial read
    const r = await lock({ action: "lock" });
    expect(r.status).toBe(200);
    expect(conditions).toHaveLength(2);
    expect(conditions[1]).toContain("is:locked_by:null");
  });

  it("CAS miss, now held by another → laast_av_annen with the REAL holder", async () => {
    matchRow = makeMatch();
    raceLost = true;
    rereads = [matchRow, makeMatch({ status: "live", locked_by: "other|Bane 2" })];
    const r = await lock({ action: "lock" });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "laast_av_annen", lockedBy: "other|Bane 2" });
    expect(conditions).toHaveLength(1); // no pointless retry on someone else's lock
  });

  it("force takes over unconditionally (no locked_by condition)", async () => {
    matchRow = makeMatch({ status: "live", locked_by: "other|X" });
    const r = await lock({ action: "force" });
    expect(r.status).toBe(200);
    expect(conditions[0].some((c) => c.includes("locked_by"))).toBe(false);
  });
});
