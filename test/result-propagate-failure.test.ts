import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, Tournament } from "@/lib/types";

// propagateResult throwing AFTER submit_match_result committed must not be a
// 5xx: a retry would hit 409 kamp_ferdig and show the referee a false conflict.

const ID = "11111111-1111-1111-1111-111111111111";
const MID = "22222222-2222-2222-2222-222222222222";

const t = {
  id: ID,
  control_code: "402815",
  scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: true },
  status: "playoff",
} as unknown as Tournament;
const m = {
  id: MID,
  tournament_id: ID,
  phase: "playoff",
  home_team_id: "h",
  away_team_id: "a",
  status: "live",
  result_version: 0,
} as unknown as Match;

vi.mock("@/lib/server/store", () => ({
  getTournament: async () => t,
  getMatch: async () => m,
  db: () => ({
    rpc: async () => ({ data: [{ ...m, status: "done" }], error: null }),
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));
vi.mock("@/lib/server/playoff", () => ({
  propagateResult: async () => {
    throw new Error("db down");
  },
}));

import { POST } from "@/app/api/match/result/route";
import { __resetRateLimiter } from "@/lib/server/http";

beforeEach(() => {
  __resetRateLimiter();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("result: propagate failure after commit", () => {
  it("answers 200 with propagated:false", async () => {
    const res = await POST(
      new Request("http://localhost/api/match/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchId: MID,
          expectedVersion: 0,
          result: { home: 2, away: 1 },
          controlCode: "402815",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.propagated).toBe(false);
    expect(body.match.status).toBe("done");
  });
});
