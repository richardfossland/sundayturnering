import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Court, Match, Tournament } from "@/lib/types";

// POST /api/organiser/call — oppkalling. Real authOrganiserOrAdmin runs (no
// signed-in session). Pinned: kode-port, forhåndssjekker, RPC-feil → riktig kode,
// og at RPC-ene kalles med riktige argumenter + broadcast.

const T = "11111111-1111-4111-8111-111111111111";
const C1 = "c1111111-1111-4111-8111-111111111111";
const C2 = "c2222222-1111-4111-8111-111111111111";
const M1 = "a1111111-1111-4111-8111-111111111111";
const M2 = "a2222222-1111-4111-8111-111111111111";

let tournamentRow: Tournament | null;
let matchesRows: Match[];
let rpcError: { code?: string; message: string } | null;
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const broadcasts: string[] = [];

vi.mock("@/lib/supabase/auth-server", () => ({
  createAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));
vi.mock("@/lib/server/store", () => ({
  getTournament: async () => tournamentRow,
  getMatches: async () => matchesRows,
  getCourts: async () =>
    [
      { id: C1, tournament_id: T, name: "Bane 1", sort_order: 0, timer: null },
      { id: C2, tournament_id: T, name: "Bane 2", sort_order: 1, timer: null },
    ] as Court[],
  db: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: null, error: rpcError };
    },
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({
  broadcast: async (_ch: string, ev: string) => {
    broadcasts.push(ev);
  },
}));

import { POST } from "@/app/api/organiser/call/route";
import { __resetRateLimiter } from "@/lib/server/http";

const tournament = (over: Partial<Tournament> = {}): Tournament =>
  ({
    id: T,
    control_code: "402815",
    board_code: "KOLE-FR",
    organiser_code: "ABCD-EF",
    organiser_id: null,
    title: "T",
    sport_label: "",
    format: "cup",
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: true },
    parallelism: "parallel",
    config: { playoffSize: 0, roundRobinDouble: false },
    status: "league",
    version: 0,
    timer: null,
    created_at: new Date().toISOString(),
    ...over,
  }) as Tournament;

const match = (id: string, over: Partial<Match> = {}): Match =>
  ({
    id,
    tournament_id: T,
    phase: "league",
    round: 1,
    bracket_slot: null,
    group_no: null,
    court_id: null,
    queue_order: 0,
    scheduled_at: null,
    called_at: null,
    home_team_id: id === M1 ? "h1" : "h2",
    away_team_id: id === M1 ? "a1" : "a2",
    status: "scheduled",
    result: null,
    winner_team_id: null,
    locked_by: null,
    result_by: null,
    result_version: 0,
    updated_at: "2026-10-25T09:00:00.000Z",
    ...over,
  }) as Match;

const post = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/organiser/call", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "10.3.3.3" },
      body: JSON.stringify(body),
    }),
  );
const auth = { tournamentId: T, organiserCode: "ABCD-EF" };

beforeEach(() => {
  __resetRateLimiter();
  tournamentRow = tournament();
  matchesRows = [match(M1), match(M2)];
  rpcError = null;
  rpcCalls.length = 0;
  broadcasts.length = 0;
});

describe("POST /api/organiser/call — auth", () => {
  it("403 with a wrong or missing organiser code", async () => {
    let res = await post({ ...auth, organiserCode: "WRONG-X", matchId: M1, courtId: C1 });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "feil_arrangorkode" });
    res = await post({ tournamentId: T, matchId: M1, courtId: C1 });
    expect(res.status).toBe(403);
    expect(rpcCalls.filter((c) => c.fn.endsWith("call_match"))).toHaveLength(0);
  });
});

describe("POST /api/organiser/call — call", () => {
  it("calls the match via RPC and broadcasts", async () => {
    const res = await post({ ...auth, matchId: M1, courtId: C1 });
    expect(res.status).toBe(200);
    expect(rpcCalls.filter((c) => c.fn.endsWith("call_match"))).toEqual([{ fn: "call_match", args: { p_match: M1, p_court: C1 } }]);
    await Promise.resolve();
    expect(broadcasts).toContain("structure");
  });

  it("400 without matchId / courtId", async () => {
    expect((await post({ ...auth, courtId: C1 })).status).toBe(400);
    expect((await post({ ...auth, matchId: M1 })).status).toBe(400);
    expect((await post({ ...auth, matchId: M1, courtId: "x" })).status).toBe(400);
  });

  it("404 for an unknown match, 404 for a court that is not in the tournament", async () => {
    expect((await post({ ...auth, matchId: "b1111111-1111-4111-8111-111111111111", courtId: C1 })).status).toBe(404);
    const res = await post({ ...auth, matchId: M1, courtId: "d1111111-1111-4111-8111-111111111111" });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "bane_finnes_ikke" });
  });

  it("409 kamp_ikke_klar when the match is not scheduled or lacks a team", async () => {
    matchesRows = [match(M1, { status: "live" }), match(M2, { away_team_id: null })];
    for (const id of [M1, M2]) {
      const res = await post({ ...auth, matchId: id, courtId: C1 });
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({ error: "kamp_ikke_klar" });
    }
    expect(rpcCalls.filter((c) => c.fn.endsWith("call_match"))).toHaveLength(0);
  });

  it("409 bane_opptatt when the court already has a live/called match", async () => {
    matchesRows = [match(M1), match(M2, { status: "called", court_id: C1, home_team_id: "x", away_team_id: "y" })];
    const res = await post({ ...auth, matchId: M1, courtId: C1 });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "bane_opptatt" });
  });

  it("409 lag_opptatt when a team plays elsewhere", async () => {
    matchesRows = [match(M1), match(M2, { status: "live", court_id: C2, home_team_id: "h1", away_team_id: "y" })];
    const res = await post({ ...auth, matchId: M1, courtId: C1 });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "lag_opptatt" });
  });

  it("maps a concurrent RPC refusal (court_busy) to bane_opptatt", async () => {
    rpcError = { code: "P0422", message: "court_busy" };
    const res = await post({ ...auth, matchId: M1, courtId: C1 });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "bane_opptatt" });
    expect(broadcasts).toHaveLength(0);
  });

  it("409 turnering_avsluttet on a finished tournament", async () => {
    tournamentRow = tournament({ status: "finished" });
    const res = await post({ ...auth, matchId: M1, courtId: C1 });
    expect(res.status).toBe(409);
  });

  it("a rested-team warning is not a server error: the call still goes through", async () => {
    matchesRows = [match(M1), match(M2, { status: "done", home_team_id: "h1", away_team_id: "z", updated_at: new Date().toISOString() })];
    expect((await post({ ...auth, matchId: M1, courtId: C1 })).status).toBe(200);
  });
});

describe("POST /api/organiser/call — undo", () => {
  it("un-calls a called match (court not required)", async () => {
    matchesRows = [match(M1, { status: "called", court_id: C1 }), match(M2)];
    const res = await post({ ...auth, matchId: M1, undo: true });
    expect(res.status).toBe(200);
    expect(rpcCalls.filter((c) => c.fn.endsWith("call_match"))).toEqual([{ fn: "uncall_match", args: { p_match: M1 } }]);
  });

  it("409 ikke_kalt_opp when the match is not called", async () => {
    const res = await post({ ...auth, matchId: M1, undo: true });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "ikke_kalt_opp" });
    expect(rpcCalls.filter((c) => c.fn.endsWith("call_match"))).toHaveLength(0);
  });
});
