import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateInput } from "@/lib/server/build";

// CRITICAL invariant: anonymous /hurtig + /ny create MUST keep working and must
// stamp organiser_id = null. We mock createTournament to capture the input the
// route builds, and drive the "is an admin signed in?" lookup.

let captured: CreateInput | null = null;
vi.mock("@/lib/server/build", () => ({
  createTournament: async (input: CreateInput) => {
    captured = input;
    return {
      id: "tid",
      control_code: "123456",
      board_code: "blå-katt",
      organiser_code: "rød-hund",
    };
  },
}));

// requireAdmin() (used by getOptionalAdmin) calls createAuthClient().auth.getUser().
let currentUser: { id: string; email: string } | null = null;
vi.mock("@/lib/supabase/auth-server", () => ({
  createAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
  }),
}));

process.env.TURNERING_ADMIN_EMAILS = "owner@example.com";

import { POST } from "@/app/api/tournament/route";

function body(): CreateInput {
  return {
    title: "Test",
    sport_label: "Fotball",
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
    teams: [
      { name: "A", colour: "#111", logo_url: null, members: [] },
      { name: "B", colour: "#222", logo_url: null, members: [] },
    ],
    courts: [],
  };
}

function call() {
  return POST(
    new Request("http://localhost/api/tournament", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body()),
    }),
  );
}

describe("POST /api/tournament — organiser_id wiring", () => {
  beforeEach(() => {
    captured = null;
    currentUser = null;
  });

  it("anonymous create succeeds with organiserId null", async () => {
    currentUser = null; // no Sunday Account session
    const res = await call();
    expect(res.status).toBe(200);
    expect(captured).not.toBeNull();
    expect(captured!.organiserId).toBeNull();
  });

  it("signed-in admin create stamps organiserId = their uid", async () => {
    currentUser = { id: "uid-9", email: "owner@example.com" };
    const res = await call();
    expect(res.status).toBe(200);
    expect(captured!.organiserId).toBe("uid-9");
  });

  it("signed-in non-admin create stays anonymous (organiserId null)", async () => {
    currentUser = { id: "uid-x", email: "stranger@example.com" };
    const res = await call();
    expect(res.status).toBe(200);
    expect(captured!.organiserId).toBeNull();
  });
});
