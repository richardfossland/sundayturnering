import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, Tournament } from "@/lib/types";

// B9 — organiser override refuses a match that is a bye: a real first-round bye and
// the voided grand-final rematch (finale 2) of a double elimination.

const ID = "11111111-1111-1111-1111-111111111111";
const MID = "22222222-2222-2222-2222-222222222222";

let t: Tournament;
let m: Match;
let rpcCalls = 0;

vi.mock("@/lib/server/auth", () => ({
  authOrganiserOrAdmin: async () => t,
}));
vi.mock("@/lib/server/store", () => ({
  getMatch: async () => m,
  db: () => ({
    rpc: async () => {
      rpcCalls++;
      return { data: [{ ...m, status: "done" }], error: null };
    },
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));
vi.mock("@/lib/server/playoff", () => ({ resetDownstream: async () => 0 }));
vi.mock("@/lib/server/timer", () => ({ clearTimerAfterDone: async () => false }));

import { POST } from "@/app/api/organiser/override/route";
import { __resetRateLimiter } from "@/lib/server/http";

function match(over: Partial<Match> = {}): Match {
  return {
    id: MID, tournament_id: ID, phase: "playoff", round: 2, bracket_slot: 0, group_no: null,
    court_id: null, queue_order: 0, scheduled_at: null, called_at: null,
    home_team_id: "w", away_team_id: "l", status: "scheduled", result: null,
    winner_team_id: null, locked_by: null, result_by: null, result_version: 0, updated_at: "",
    ...over,
  };
}
const post = () =>
  POST(
    new Request("http://localhost/api/organiser/override", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "10.4.4.4" },
      body: JSON.stringify({ tournamentId: ID, organiserCode: "ABCD-EF", matchId: MID, result: { home: 0, away: 1 } }),
    }),
  );

beforeEach(() => {
  t = {
    id: ID, control_code: "402815", board_code: "KOLE-FR", organiser_code: "ABCD-EF", organiser_id: null,
    title: "T", sport_label: "", format: "double_elim",
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: false },
    parallelism: "sequential", config: { playoffSize: 0, roundRobinDouble: false },
    status: "playoff", version: 0, timer: null, created_at: new Date().toISOString(),
  } as Tournament;
  rpcCalls = 0;
  __resetRateLimiter();
});

describe("organiser override of a bye match (B9)", () => {
  it("the voided grand-final rematch (both teams, status bye) is refused with 409", async () => {
    m = match({ bracket: "GF", status: "bye", winner_team_id: "w" } as Partial<Match>);
    const res = await post();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("kamp_utgatt");
    expect(body.detail).toMatch(/kan ikke endres/);
    expect(rpcCalls).toBe(0);
  });

  it("a real first-round bye (one team missing) is refused the same way", async () => {
    m = match({ round: 1, away_team_id: null, status: "bye", winner_team_id: "w" });
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("kamp_utgatt");
    expect(rpcCalls).toBe(0);
  });

  it("an ordinary finished match is still overridden", async () => {
    m = match({ status: "done", result: { home: 1, away: 0 }, winner_team_id: "w" });
    const res = await post();
    expect(res.status).toBe(200);
    expect(rpcCalls).toBe(1);
  });
});
