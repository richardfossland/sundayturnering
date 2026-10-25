import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, Tournament } from "@/lib/types";

// Route seams for the organiser actions that had no coverage: advance, finish,
// timer, reopen. Real authOrganiserOrAdmin runs (no signed-in session), so the
// organiser-code path is what is exercised. Pinned: wrong/missing code → 403,
// happy paths, and a DB/network failure → JSON 503 (withApi), never a 500.

const ID = "11111111-1111-1111-1111-111111111111";

let tournamentRow: Tournament | null;
let matchesRows: Match[];
let dbError: { message: string } | null;
let getMatchesThrows = false;
let reopenThrows = false;
let advanceThrows: Error | null = null;
const updates: Record<string, unknown>[] = [];
let advanced = 0;
let bumped = 0;

vi.mock("@/lib/supabase/auth-server", () => ({
  createAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));
vi.mock("@/lib/server/store", () => ({
  getTournament: async () => tournamentRow,
  getMatches: async () => {
    if (getMatchesThrows) throw new Error("db down");
    return matchesRows;
  },
  bumpVersion: async () => {
    bumped++;
  },
  db: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          updates.push(patch);
          return { error: dbError };
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));
vi.mock("@/lib/server/playoff", () => ({
  advanceToPlayoff: async () => {
    if (advanceThrows) throw advanceThrows;
    advanced++;
  },
  reopenTournament: async () => {
    if (reopenThrows) throw new Error("db down");
    return "playoff" as const;
  },
}));

import { POST as advance } from "@/app/api/organiser/advance/route";
import { POST as finish } from "@/app/api/organiser/finish/route";
import { POST as timer } from "@/app/api/organiser/timer/route";
import { POST as reopen } from "@/app/api/organiser/reopen/route";
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
    format: "league_playoff",
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: true },
    parallelism: "sequential",
    config: { playoffSize: 4, roundRobinDouble: false },
    status: "league",
    version: 0,
    timer: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

function post(handler: (req: Request) => Promise<Response>, body: Record<string, unknown>) {
  return handler(
    new Request("http://localhost/api/organiser/x", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "10.2.2.2" },
      body: JSON.stringify(body),
    }),
  );
}
const auth = { tournamentId: ID, organiserCode: "ABCD-EF" };

beforeEach(() => {
  __resetRateLimiter();
  tournamentRow = tournament();
  matchesRows = [];
  dbError = null;
  getMatchesThrows = false;
  reopenThrows = false;
  advanceThrows = null;
  updates.length = 0;
  advanced = 0;
  bumped = 0;
});

const cases: [string, (req: Request) => Promise<Response>, Record<string, unknown>][] = [
  ["advance", advance, { force: true }],
  ["finish", finish, {}],
  ["timer", timer, { action: "start", durationSec: 300 }],
  ["reopen", reopen, {}],
];

describe.each(cases)("POST /api/organiser/%s — auth", (_name, handler, extra) => {
  it("403 feil_arrangorkode with a wrong code", async () => {
    tournamentRow = tournament({ status: "finished" });
    const res = await post(handler, { ...extra, ...auth, organiserCode: "WRONG-X" });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "feil_arrangorkode" });
    expect(updates).toHaveLength(0);
    expect(advanced).toBe(0);
  });

  it("403 with no code at all", async () => {
    const res = await post(handler, { ...extra, tournamentId: ID });
    expect(res.status).toBe(403);
  });

  it("403 when the tournament does not exist", async () => {
    tournamentRow = null;
    const res = await post(handler, { ...extra, ...auth });
    expect(res.status).toBe(403);
  });

  it("403 on a malformed body", async () => {
    const res = await handler(
      new Request("http://localhost/api/organiser/x", {
        method: "POST",
        headers: { "cf-connecting-ip": "10.2.2.2" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/organiser/advance", () => {
  it("200 and builds the playoff with the right code", async () => {
    const res = await post(advance, { ...auth, force: true });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(advanced).toBe(1);
  });

  it("accepts the code case-insensitively", async () => {
    const res = await post(advance, { ...auth, organiserCode: "abcd-ef", force: true });
    expect(res.status).toBe(200);
  });

  it("409 uspilte_kamper with a count when league matches are unplayed (no force)", async () => {
    matchesRows = [
      { phase: "league", status: "scheduled" },
      { phase: "league", status: "live" },
      { phase: "league", status: "done" },
      { phase: "league", status: "bye" },
    ] as Match[];
    const res = await post(advance, auth);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "uspilte_kamper", count: 2 });
    expect(advanced).toBe(0);
  });

  it("400 ikke_sluttspillformat for a pure league", async () => {
    tournamentRow = tournament({ format: "league" });
    const res = await post(advance, auth);
    expect(res.status).toBe(400);
  });

  it("409 allerede_avansert once in playoff", async () => {
    tournamentRow = tournament({ status: "playoff" });
    const res = await post(advance, auth);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "allerede_avansert" });
  });

  it("400 kunne_ikke_avansere when the bracket build throws", async () => {
    advanceThrows = new Error("for få lag");
    const res = await post(advance, { ...auth, force: true });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "kunne_ikke_avansere", detail: "for få lag" });
  });

  it("503 midlertidig_feil when reading matches fails", async () => {
    getMatchesThrows = true;
    const res = await post(advance, auth);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "midlertidig_feil" });
  });
});

describe("POST /api/organiser/finish", () => {
  it("200, sets status finished and bumps the version", async () => {
    const res = await post(finish, auth);
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ status: "finished" }]);
    expect(bumped).toBe(1);
  });

  it("503 when the DB write fails, and the version is not bumped", async () => {
    dbError = { message: "boom" };
    const res = await post(finish, auth);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "midlertidig_feil" });
    expect(bumped).toBe(0);
  });
});

describe("POST /api/organiser/timer", () => {
  it("200 start stores a running timer", async () => {
    const res = await post(timer, { ...auth, action: "start", durationSec: 300 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.timer).toBeTruthy();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toHaveProperty("timer");
    expect(bumped).toBe(1);
  });

  it("200 stop returns a (stopped) timer payload", async () => {
    const res = await post(timer, { ...auth, action: "stop" });
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
  });

  it("503 when the DB write fails", async () => {
    dbError = { message: "boom" };
    const res = await post(timer, { ...auth, action: "start", durationSec: 60 });
    expect(res.status).toBe(503);
    expect(bumped).toBe(0);
  });
});

describe("POST /api/organiser/reopen", () => {
  it("200 with the prior status when finished", async () => {
    tournamentRow = tournament({ status: "finished" });
    const res = await post(reopen, auth);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, status: "playoff" });
  });

  it("409 ikke_avsluttet when not finished", async () => {
    const res = await post(reopen, auth);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "ikke_avsluttet" });
  });

  it("503 when reopening hits a DB failure", async () => {
    tournamentRow = tournament({ status: "finished" });
    reopenThrows = true;
    const res = await post(reopen, auth);
    expect(res.status).toBe(503);
  });
});

describe("organiser rate limit", () => {
  it("429 for_mange_forsok after 30 calls/min from one IP", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await post(finish, auth)).status;
    expect(last).toBe(429);
  });
});
