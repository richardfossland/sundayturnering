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
  getMatch: async () => matchRow,
  db: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          patches.push(patch);
          return { error: null };
        },
      }),
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
    queue_order: 0,
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
    expect(patches).toEqual([{ locked_by: null, status: "scheduled", result: null }]);
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
});
