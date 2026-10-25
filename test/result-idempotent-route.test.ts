import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, Tournament } from "@/lib/types";

// A queued referee result is re-sent until answered. A repeat of a request id
// that already committed must return the same outcome, even though the match
// is now «done» and the tournament may even be finished (guards that would
// otherwise answer 409 to the referee's own write).

const ID = "11111111-1111-1111-1111-111111111111";
const MID = "22222222-2222-2222-2222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";

let t: Tournament;
let m: Match;
let prior: unknown = null;
const calls: { fn: string; args: Record<string, unknown> }[] = [];

vi.mock("@/lib/server/store", () => ({
  getTournament: async () => t,
  getMatch: async () => m,
  db: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "code_blocked") return { data: false, error: null };
      if (fn === "result_request_outcome") return { data: prior, error: null };
      return { data: [{ ...m, status: "done", result_version: 1 }], error: null };
    },
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));
const propagated: unknown[] = [];
let propagateFails = false;
vi.mock("@/lib/server/playoff", () => ({
  propagateResult: async (mm: unknown) => {
    propagated.push(mm);
    if (propagateFails) throw new Error("db down");
    return true;
  },
}));

import { POST } from "@/app/api/match/result/route";
import { __resetRateLimiter } from "@/lib/server/http";

function post(extra: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/match/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matchId: MID,
        expectedVersion: 0,
        result: { home: 2, away: 1 },
        controlCode: "402815",
        ...extra,
      }),
    }),
  );
}
const submits = () => calls.filter((c) => c.fn === "submit_match_result");

beforeEach(() => {
  __resetRateLimiter();
  calls.length = 0;
  propagated.length = 0;
  propagateFails = false;
  prior = null;
  t = {
    id: ID,
    control_code: "402815",
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: true },
    status: "league",
  } as unknown as Tournament;
  m = {
    id: MID,
    tournament_id: ID,
    phase: "league",
    home_team_id: "h",
    away_team_id: "a",
    status: "live",
    result_version: 0,
  } as unknown as Match;
});

describe("result route: requestId", () => {
  it("passes a valid requestId to the RPC", async () => {
    const res = await post({ requestId: REQ });
    expect(res.status).toBe(200);
    expect(submits()[0].args.p_request_id).toBe(REQ);
  });

  it("without requestId the call is exactly the legacy one", async () => {
    await post({});
    expect("p_request_id" in submits()[0].args).toBe(false);
  });

  it("rejects a malformed requestId with 400 and writes nothing", async () => {
    expect((await post({ requestId: "nope" })).status).toBe(400);
    expect((await post({ requestId: 5 })).status).toBe(400);
    expect(submits()).toEqual([]);
  });

  it("replay of a committed id: 200 with the stored match, no second write", async () => {
    m = { ...m, status: "done", result_version: 1 } as Match;
    t = { ...t, status: "finished" } as Tournament;
    prior = { id: MID, status: "done", result_version: 1 };
    const res = await post({ requestId: REQ });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.match.result_version).toBe(1);
    expect(body.replay).toBe(true);
    expect(submits()).toEqual([]);
  });

  it("replay still needs the control code", async () => {
    m = { ...m, status: "done", result_version: 1 } as Match;
    prior = { id: MID, status: "done", result_version: 1 };
    const res = await post({ requestId: REQ, controlCode: "000000" });
    expect(res.status).toBe(403);
  });

  it("a done match with an UNKNOWN id is still 409 kamp_ferdig", async () => {
    m = { ...m, status: "done", result_version: 1 } as Match;
    const res = await post({ requestId: REQ });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("kamp_ferdig");
    expect(submits()).toEqual([]);
  });

  it("replay of a playoff match re-runs propagation (lost first propagation)", async () => {
    m = { ...m, phase: "playoff", status: "done", result_version: 1 } as Match;
    prior = { id: MID, phase: "playoff", status: "done", result_version: 1, winner_team_id: "h" };
    const res = await post({ requestId: REQ });
    expect(res.status).toBe(200);
    expect(propagated).toEqual([prior]);
    expect(submits()).toEqual([]);
  });

  it("replay: a propagation failure is flagged, not a 5xx", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    propagateFails = true;
    m = { ...m, phase: "playoff", status: "done", result_version: 1 } as Match;
    prior = { id: MID, phase: "playoff", status: "done", result_version: 1, winner_team_id: "h" };
    const res = await post({ requestId: REQ });
    expect(res.status).toBe(200);
    expect((await res.json()).propagated).toBe(false);
  });

  it("replay of a league match does not propagate", async () => {
    m = { ...m, status: "done", result_version: 1 } as Match;
    prior = { id: MID, phase: "league", status: "done", result_version: 1 };
    await post({ requestId: REQ });
    expect(propagated).toEqual([]);
  });
});
