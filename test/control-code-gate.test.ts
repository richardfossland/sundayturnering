import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, Tournament } from "@/lib/types";

// SECURITY seam: match/tournament ids are public (they are in the state DTO
// every spectator on /se/[id] downloads), so the referee write routes must
// require the six-digit control code. Without this, anyone with the "follow
// live" link could enter results, take locks and drive the board clock.

const ID = "11111111-1111-1111-1111-111111111111";
const MID = "22222222-2222-2222-2222-222222222222";

let tournamentRow: Tournament | null = null;
let matchRow: Match | null = null;
const writes: string[] = [];

vi.mock("@/lib/server/store", () => ({
  getTournament: async () => tournamentRow,
  getMatch: async () => matchRow,
  bumpVersion: async () => {
    writes.push("bump");
  },
  db: () => ({
    rpc: async (fn: string) => {
      writes.push(`rpc:${fn}`);
      return { data: [{ ...matchRow, status: "done", result_version: 1 }], error: null };
    },
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          writes.push(`update:${table}:${Object.keys(patch).join(",")}`);
          return { error: null };
        },
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));
vi.mock("@/lib/server/playoff", () => ({ propagateResult: async () => false }));

import { POST as result } from "@/app/api/match/result/route";
import { POST as lock } from "@/app/api/match/lock/route";
import { POST as correct } from "@/app/api/match/correct/route";
import { POST as timer } from "@/app/api/match/timer/route";

function makeTournament(): Tournament {
  return {
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
    created_at: new Date().toISOString(),
  };
}
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
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function post(handler: (req: Request) => Promise<Response>, body: Record<string, unknown>) {
  return handler(
    new Request("http://localhost/api/x", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify(body),
    }),
  );
}

const resultBody = { matchId: MID, expectedVersion: 0, result: { home: 2, away: 1 }, deviceId: "d1" };
const lockBody = { matchId: MID, deviceId: "d1", deviceName: "Bane 1", action: "lock" };
const timerBody = { tournamentId: ID, action: "start", durationSec: 300 };

describe("referee routes require the control code", () => {
  beforeEach(() => {
    tournamentRow = makeTournament();
    matchRow = makeMatch();
    writes.length = 0;
  });

  it("result: 403 without a code, nothing written", async () => {
    const res = await post(result, resultBody);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("feil_kontrollkode");
    expect(writes).toEqual([]);
  });

  it("result: 403 with a wrong or malformed code", async () => {
    expect((await post(result, { ...resultBody, controlCode: "000000" })).status).toBe(403);
    expect((await post(result, { ...resultBody, controlCode: "40281" })).status).toBe(403);
    expect((await post(result, { ...resultBody, controlCode: 402815 })).status).toBe(403);
    expect(writes).toEqual([]);
  });

  it("result: proceeds to the RPC with the right code (whitespace tolerated)", async () => {
    const res = await post(result, { ...resultBody, controlCode: " 402815 " });
    expect(res.status).toBe(200);
    expect(writes).toContain("rpc:submit_match_result");
  });

  it("lock: 403 without the code, no status change", async () => {
    const res = await post(lock, lockBody);
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
  });

  it("lock: works with the code (match goes live)", async () => {
    const res = await post(lock, { ...lockBody, controlCode: "402815" });
    expect(res.status).toBe(200);
    expect(writes.some((w) => w.startsWith("update:matches:locked_by,status"))).toBe(true);
  });

  it("correct: the code is checked before the self-correct window", async () => {
    matchRow = makeMatch({ status: "done", result_by: "d1|Bane 1", result: { home: 1, away: 0 } });
    const res = await post(correct, resultBody);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("feil_kontrollkode");
    expect(writes).toEqual([]);
    const ok = await post(correct, { ...resultBody, controlCode: "402815" });
    expect(ok.status).toBe(200);
  });

  it("timer: the public tournament id alone cannot drive the board clock", async () => {
    const res = await post(timer, timerBody);
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
    const ok = await post(timer, { ...timerBody, controlCode: "402815" });
    expect(ok.status).toBe(200);
    expect(writes).toContain("update:tournaments:timer");
  });
});
