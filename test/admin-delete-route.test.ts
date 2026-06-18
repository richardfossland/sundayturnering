import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tournament } from "@/lib/types";

// ---- mock the AUTH client (Sunday Account issuer) ----
// requireAdmin() calls createAuthClient().auth.getUser(); we drive who is "signed
// in" by swapping the user this returns.
let currentUser: { id: string; email: string } | null = null;
vi.mock("@/lib/supabase/auth-server", () => ({
  createAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
  }),
}));

// ---- mock the data store (service-role) ----
// getTournament returns the row under test; db().from().delete().eq() records the
// delete so we can assert it (or assert it never ran).
let tournamentRow: Tournament | null = null;
const deleted: string[] = [];
vi.mock("@/lib/server/store", () => ({
  getTournament: async () => tournamentRow,
  db: () => ({
    from: () => ({
      delete: () => ({
        eq: async (_col: string, id: string) => {
          deleted.push(id);
          return { error: null };
        },
      }),
    }),
  }),
}));

// Allowlist: only this email is an admin (TURNERING_ADMIN_EMAILS).
process.env.TURNERING_ADMIN_EMAILS = "owner@example.com";

import { DELETE } from "@/app/api/tournament/[id]/route";

const ID = "11111111-1111-1111-1111-111111111111";
const OWNER_ID = "owner-uid";

function makeTournament(over: Partial<Tournament> = {}): Tournament {
  return {
    id: ID,
    control_code: "123456",
    board_code: "blå-katt",
    organiser_code: "rød-hund",
    organiser_id: OWNER_ID,
    title: "T",
    sport_label: "",
    format: "cup",
    scoring: {
      profile: "simple",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      allowDraw: false,
    },
    parallelism: "sequential",
    config: { playoffSize: 0, roundRobinDouble: false },
    status: "playoff",
    version: 0,
    timer: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

function call() {
  return DELETE(new Request(`http://localhost/api/tournament/${ID}`, { method: "DELETE" }), {
    params: Promise.resolve({ id: ID }),
  });
}

describe("DELETE /api/tournament/[id]", () => {
  beforeEach(() => {
    currentUser = null;
    tournamentRow = makeTournament();
    deleted.length = 0;
  });

  it("401 when no session", async () => {
    currentUser = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(deleted).toHaveLength(0);
  });

  it("403 when signed in but not on the admin allowlist", async () => {
    currentUser = { id: "someone", email: "stranger@example.com" };
    const res = await call();
    expect(res.status).toBe(403);
    expect(deleted).toHaveLength(0);
  });

  it("403 when admin does not own the tournament", async () => {
    currentUser = { id: "other-admin", email: "owner@example.com" };
    tournamentRow = makeTournament({ organiser_id: "someone-else" });
    const res = await call();
    expect(res.status).toBe(403);
    expect(deleted).toHaveLength(0);
  });

  it("403 when the tournament is anonymous (organiser_id null)", async () => {
    currentUser = { id: OWNER_ID, email: "owner@example.com" };
    tournamentRow = makeTournament({ organiser_id: null });
    const res = await call();
    expect(res.status).toBe(403);
    expect(deleted).toHaveLength(0);
  });

  it("404 when the tournament does not exist", async () => {
    currentUser = { id: OWNER_ID, email: "owner@example.com" };
    tournamentRow = null;
    const res = await call();
    expect(res.status).toBe(404);
    expect(deleted).toHaveLength(0);
  });

  it("200 and deletes when the owning admin calls", async () => {
    currentUser = { id: OWNER_ID, email: "owner@example.com" };
    tournamentRow = makeTournament({ organiser_id: OWNER_ID });
    const res = await call();
    expect(res.status).toBe(200);
    expect(deleted).toEqual([ID]);
  });
});
