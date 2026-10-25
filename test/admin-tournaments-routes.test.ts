import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tournament } from "@/lib/types";

// Admin-gated routes: GET /api/admin/tournaments (own list) and
// POST /api/admin/tournaments/[id]/reopen. Real auth.ts runs; only the session
// and the store are stubbed. These routes catch their own errors, so an
// outage is a JSON 500 with a route-specific code (not the withApi 503).

let currentUser: { id: string; email: string } | null = null;
vi.mock("@/lib/supabase/auth-server", () => ({
  createAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
  }),
}));

let tournamentRow: Tournament | null;
let listThrows = false;
let reopenThrows = false;
let listedFor: string[] = [];
vi.mock("@/lib/server/store", () => ({
  getTournament: async () => tournamentRow,
  listTournamentsByOrganiser: async (id: string) => {
    if (listThrows) throw new Error("db down");
    listedFor.push(id);
    return [{ id: "t1", title: "Mitt cup" }];
  },
}));
vi.mock("@/lib/server/playoff", () => ({
  reopenTournament: async () => {
    if (reopenThrows) throw new Error("db down");
    return "league" as const;
  },
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));

process.env.TURNERING_ADMIN_EMAILS = "owner@example.com";

import { GET as list } from "@/app/api/admin/tournaments/route";
import { POST as reopen } from "@/app/api/admin/tournaments/[id]/reopen/route";

const ID = "11111111-1111-1111-1111-111111111111";
const OWNER = { id: "owner-uid", email: "owner@example.com" };

function tournament(over: Partial<Tournament> = {}): Tournament {
  return {
    id: ID,
    control_code: "402815",
    board_code: "KOLE-FR",
    organiser_code: "ABCD-EF",
    organiser_id: OWNER.id,
    title: "T",
    sport_label: "",
    format: "league",
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: true },
    parallelism: "sequential",
    config: { playoffSize: 0, roundRobinDouble: false },
    status: "finished",
    version: 0,
    timer: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}
const callReopen = () =>
  reopen(new Request(`http://localhost/api/admin/tournaments/${ID}/reopen`, { method: "POST" }), {
    params: Promise.resolve({ id: ID }),
  });

beforeEach(() => {
  currentUser = null;
  tournamentRow = tournament();
  listThrows = false;
  reopenThrows = false;
  listedFor = [];
});

describe("GET /api/admin/tournaments", () => {
  it("401 without a session", async () => {
    const res = await list();
    expect(res.status).toBe(401);
    expect(listedFor).toHaveLength(0);
  });

  it("403 for a signed-in non-admin", async () => {
    currentUser = { id: "x", email: "stranger@example.com" };
    const res = await list();
    expect(res.status).toBe(403);
    expect(listedFor).toHaveLength(0);
  });

  it("200 lists the caller's own tournaments", async () => {
    currentUser = OWNER;
    const res = await list();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ tournaments: [{ id: "t1", title: "Mitt cup" }] });
    expect(listedFor).toEqual([OWNER.id]);
  });

  it("500 kunne_ikke_hente when the DB read fails", async () => {
    currentUser = OWNER;
    listThrows = true;
    const res = await list();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "kunne_ikke_hente" });
  });
});

describe("POST /api/admin/tournaments/[id]/reopen", () => {
  it("401 without a session", async () => {
    expect((await callReopen()).status).toBe(401);
  });

  it("403 for a non-admin", async () => {
    currentUser = { id: "x", email: "stranger@example.com" };
    expect((await callReopen()).status).toBe(403);
  });

  it("403 ikke_eier when the admin does not own it", async () => {
    currentUser = OWNER;
    tournamentRow = tournament({ organiser_id: "someone-else" });
    const res = await callReopen();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "ikke_eier" });
  });

  it("404 when it does not exist", async () => {
    currentUser = OWNER;
    tournamentRow = null;
    expect((await callReopen()).status).toBe(404);
  });

  it("409 ikke_avsluttet when not finished", async () => {
    currentUser = OWNER;
    tournamentRow = tournament({ status: "league" });
    const res = await callReopen();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "ikke_avsluttet" });
  });

  it("200 with the prior status for the owner", async () => {
    currentUser = OWNER;
    const res = await callReopen();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, status: "league" });
  });

  it("500 kunne_ikke_gjenapne when the reopen fails", async () => {
    currentUser = OWNER;
    reopenThrows = true;
    const res = await callReopen();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "kunne_ikke_gjenapne" });
  });
});
