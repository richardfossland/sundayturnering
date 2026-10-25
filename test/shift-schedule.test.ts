import { describe, it, expect, vi, beforeEach } from "vitest";
import { previewShift } from "@/lib/tournament/schedule";
import type { Match, Tournament } from "@/lib/types";

const NOW = Date.parse("2026-10-25T09:00:00.000Z");
const MIN = 60_000;
const at = (min: number) => new Date(NOW + min * MIN).toISOString();
const C1 = "c1111111-1111-4111-8111-111111111111";
const C2 = "c2222222-2222-4222-8222-222222222222";

const m = (
  id: string,
  min: number | null,
  court: string | null = C1,
  status: Match["status"] = "scheduled",
) => ({ id, court_id: court, status, scheduled_at: min === null ? null : at(min) });

const req = (over: Partial<Parameters<typeof previewShift>[1]> = {}) => ({
  courtId: null,
  fromIso: at(0),
  minutes: 10,
  nowIso: at(0),
  ...over,
});

describe("previewShift", () => {
  const ms = [
    m("a", 5, C1),
    m("b", 10, C2),
    m("c", 20, C1),
    m("d", 30, C1, "done"),
    m("e", 40, C1, "bye"),
    m("f", null, C1),
    m("old", -30, C1),
  ];

  it("shifts all courts from `from`, leaving done/bye/untimed/earlier alone", () => {
    const r = previewShift(ms, req());
    expect(r.error).toBeNull();
    expect(r.changes.map((c) => c.matchId)).toEqual(["a", "b", "c"]);
    expect(r.changes[0]).toEqual({ matchId: "a", before: at(5), after: at(15) });
  });

  it("filters by court", () => {
    const r = previewShift(ms, req({ courtId: C2 }));
    expect(r.changes.map((c) => c.matchId)).toEqual(["b"]);
  });

  it("respects `from` (inclusive)", () => {
    const r = previewShift(ms, req({ fromIso: at(10) }));
    expect(r.changes.map((c) => c.matchId)).toEqual(["b", "c"]);
  });

  it("allows a negative shift that stays after now", () => {
    const r = previewShift(ms, req({ minutes: -5 }));
    expect(r.error).toBeNull();
    expect(r.changes[0].after).toBe(at(0));
  });

  it("refuses a negative shift that lands before now (1 min slack)", () => {
    expect(previewShift(ms, req({ minutes: -6 })).error).toBeNull(); // exactly 1 min slack
    expect(previewShift(ms, req({ minutes: -7 })).error).toBe("skyv_for_tidlig");
    expect(previewShift(ms, req({ minutes: -5, nowIso: at(1) })).error).toBeNull();
    expect(previewShift(ms, req({ minutes: -5, nowIso: at(2) })).error).toBe("skyv_for_tidlig");
  });

  it("enforces limits and input validity", () => {
    expect(previewShift(ms, req({ minutes: 240 })).error).toBeNull();
    expect(previewShift(ms, req({ minutes: 241 })).error).toBe("for_stort_skyv");
    expect(previewShift(ms, req({ minutes: -241 })).error).toBe("for_stort_skyv");
    expect(previewShift(ms, req({ minutes: 0 })).error).toBe("ugyldig_skyv");
    expect(previewShift(ms, req({ minutes: 1.5 })).error).toBe("ugyldig_skyv");
    expect(previewShift(ms, req({ minutes: NaN })).error).toBe("ugyldig_skyv");
    expect(previewShift(ms, req({ fromIso: "nope" })).error).toBe("ugyldig_skyv");
  });

  it("reports ingen_kamper when nothing matches", () => {
    expect(previewShift(ms, req({ fromIso: at(500) })).error).toBe("ingen_kamper");
  });
});

// ---- route -------------------------------------------------------------
const ID = "11111111-1111-1111-1111-111111111111";
let tournamentRow: Tournament | null;
let matchesRows: Match[];
let rpcResult: { data?: unknown; error: { code?: string; message: string } | null };
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let broadcasts = 0;

vi.mock("@/lib/supabase/auth-server", () => ({
  createAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));
vi.mock("@/lib/server/store", () => ({
  getTournament: async () => tournamentRow,
  getMatches: async () => matchesRows,
  db: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn !== "shift_schedule") return { data: false, error: null };
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({
  broadcast: async () => {
    broadcasts++;
  },
}));

import { POST as shift } from "@/app/api/organiser/shift/route";
import { __resetRateLimiter } from "@/lib/server/http";

function tournament(over: Partial<Tournament> = {}): Tournament {
  return {
    id: ID,
    control_code: "402815",
    board_code: "KOLE-FR",
    organiser_code: "ABCD-EF",
    organiser_id: null,
    title: "T",
    sport_label: "",
    format: "cup",
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: true },
    parallelism: "sequential",
    config: {
      schedule: { startAt: at(0), matchMinutes: 10, breakMinutes: 0, minRestMinutes: 0 },
    },
    status: "league",
    version: 0,
    timer: null,
    created_at: new Date().toISOString(),
    ...over,
  } as Tournament;
}

function post(body: Record<string, unknown>) {
  return shift(
    new Request("http://localhost/api/organiser/shift", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "10.3.3.3" },
      body: JSON.stringify(body),
    }),
  );
}

// Route compares against the real clock, so schedule relative to it.
const inFuture = (min: number) => new Date(Date.now() + min * MIN).toISOString();
const auth = { tournamentId: ID, organiserCode: "ABCD-EF" };

beforeEach(() => {
  __resetRateLimiter();
  tournamentRow = tournament();
  matchesRows = [
    { id: "a", court_id: C1, status: "scheduled", scheduled_at: inFuture(30) },
    { id: "b", court_id: C2, status: "scheduled", scheduled_at: inFuture(40) },
  ] as Match[];
  rpcResult = { data: 2, error: null };
  rpcCalls.length = 0;
  broadcasts = 0;
});

describe("POST /api/organiser/shift", () => {
  it("403 feil_arrangorkode with a wrong code", async () => {
    const res = await post({ ...auth, organiserCode: "WRONG-X", courtId: null, from: inFuture(0), minutes: 5 });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("feil_arrangorkode");
    expect(rpcCalls).toHaveLength(0);
  });

  it("403 without a code", async () => {
    const res = await post({ tournamentId: ID, courtId: null, from: inFuture(0), minutes: 5 });
    expect(res.status).toBe(403);
  });

  it("400 ingen_tidsplan when the tournament has no schedule", async () => {
    tournamentRow = tournament({ config: {} as Tournament["config"] });
    const res = await post({ ...auth, courtId: null, from: inFuture(0), minutes: 5 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ingen_tidsplan");
  });

  it("happy path: calls the RPC, returns the count and broadcasts", async () => {
    const from = inFuture(0);
    const res = await post({ ...auth, courtId: C1, from, minutes: 10 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 2 });
    expect(rpcCalls).toEqual([
      {
        fn: "shift_schedule",
        args: { p_tournament: ID, p_court: C1, p_from: from, p_minutes: 10 },
      },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(broadcasts).toBe(1);
  });

  it("rejects invalid shifts before touching the DB", async () => {
    let res = await post({ ...auth, courtId: null, from: inFuture(0), minutes: 241 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("for_stort_skyv");
    res = await post({ ...auth, courtId: null, from: inFuture(0), minutes: -60 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("skyv_for_tidlig");
    res = await post({ ...auth, courtId: "not-a-uuid", from: inFuture(0), minutes: 5 });
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it("maps a DB-side refusal (P0422) to a friendly error", async () => {
    rpcResult = { error: { code: "P0422", message: "shift_in_past" } };
    const res = await post({ ...auth, courtId: null, from: inFuture(0), minutes: 5 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("skyv_for_tidlig");
  });

  it("a DB failure is a JSON 503, never a 500", async () => {
    rpcResult = { error: { code: "XX000", message: "boom" } };
    const res = await post({ ...auth, courtId: null, from: inFuture(0), minutes: 5 });
    expect(res.status).toBe(503);
  });
});
