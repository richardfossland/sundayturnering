import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, Tournament } from "@/lib/types";

// A6: lagres en kamp som ferdig (resultat-ruta, og overstyring første gang),
// nullstilles banens nedtelling. En overstyring av en ALLEREDE ferdig kamp (retting)
// rører ikke klokka — den hører til kampen som spilles nå.

const ID = "11111111-1111-1111-1111-111111111111";
const MID = "22222222-2222-2222-2222-222222222222";
const COURT = "33333333-3333-3333-3333-333333333333";

const t = {
  id: ID,
  control_code: "402815",
  scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: true },
  status: "league",
  parallelism: "parallel",
} as unknown as Tournament;
let m: Match;
const cleared: { t: string; m: string; court: string | null }[] = [];

vi.mock("@/lib/server/store", () => ({
  getTournament: async () => t,
  getMatch: async () => m,
  db: () => ({
    rpc: async (fn: string) => {
      if (fn === "code_blocked") return { data: false, error: null };
      return { data: [{ ...m, status: "done", result_version: 1 }], error: null };
    },
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));
vi.mock("@/lib/server/playoff", () => ({ propagateResult: async () => true, resetDownstream: async () => 0 }));
vi.mock("@/lib/server/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/auth")>()),
  authOrganiserOrAdmin: async () => t,
}));
vi.mock("@/lib/server/timer", () => ({
  clearTimerAfterDone: async (tt: Tournament, saved: Match) => {
    cleared.push({ t: tt.id, m: saved.id, court: saved.court_id });
    return true;
  },
}));

import { POST as result } from "@/app/api/match/result/route";
import { POST as override } from "@/app/api/organiser/override/route";
import { __resetRateLimiter } from "@/lib/server/http";

const post = (route: typeof result, body: Record<string, unknown>) =>
  route(
    new Request("http://localhost/api/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  __resetRateLimiter();
  cleared.length = 0;
  m = {
    id: MID,
    tournament_id: ID,
    phase: "league",
    court_id: COURT,
    home_team_id: "h",
    away_team_id: "a",
    status: "live",
    result_version: 0,
  } as unknown as Match;
});

describe("nedtelling nullstilles når kampen er ferdig", () => {
  it("resultat-ruta", async () => {
    const res = await post(result, { matchId: MID, expectedVersion: 0, result: { home: 2, away: 1 }, controlCode: "402815" });
    expect(res.status).toBe(200);
    expect(cleared).toEqual([{ t: ID, m: MID, court: COURT }]);
  });

  it("overstyring av en kamp som ikke var ferdig", async () => {
    const res = await post(override, { tournamentId: ID, organiserCode: "x", matchId: MID, result: { home: 2, away: 1 } });
    expect(res.status).toBe(200);
    expect(cleared).toHaveLength(1);
  });

  it("overstyring av en allerede ferdig kamp (retting) lar klokka stå", async () => {
    m = { ...m, status: "done", winner_team_id: "h" } as Match;
    const res = await post(override, { tournamentId: ID, organiserCode: "x", matchId: MID, result: { home: 0, away: 3 } });
    expect(res.status).toBe(200);
    expect(cleared).toHaveLength(0);
  });

  it("avvist resultat (409) nullstiller ingenting", async () => {
    m = { ...m, status: "done" } as Match;
    const res = await post(result, { matchId: MID, expectedVersion: 0, result: { home: 2, away: 1 }, controlCode: "402815" });
    expect(res.status).toBe(409);
    expect(cleared).toHaveLength(0);
  });
});
