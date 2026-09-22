import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tournament } from "@/lib/types";

// SECURITY seam: GET /api/tournament/[id] is anonymous — the public follow
// links (/se, /live) read it. It used to carry control_code, which is the
// referee credential for every write route, so anyone holding a follow link
// could enter results. The codes now travel only from /api/attach, to a
// device that has just proved one.

const ID = "11111111-1111-1111-1111-111111111111";

const tournament: Tournament = {
  id: ID,
  control_code: "402815",
  board_code: "KOLE-FR",
  organiser_code: "ABCD-EF",
  organiser_id: null,
  title: "Cup",
  sport_label: "",
  format: "league",
  scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: true },
  parallelism: "sequential",
  config: { playoffSize: 0, roundRobinDouble: false },
  status: "league",
  version: 1,
  timer: null,
  created_at: "2026-09-22T00:00:00Z",
};

// Chainable fake PostgREST client: every builder method returns the chain,
// awaiting it yields the table's rows, maybeSingle() the first row.
const rows: Record<string, unknown[]> = {};
function chain(table: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: rows[table]?.[0] ?? null, error: null });
  c.then = (res: (v: unknown) => unknown) => res({ data: rows[table] ?? [], error: null });
  return c;
}
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: (t: string) => chain(t) }),
}));

import { GET } from "@/app/api/tournament/[id]/route";
import { POST as attach } from "@/app/api/attach/route";
import { __resetRateLimiter } from "@/lib/server/http";

beforeEach(() => {
  rows.tournaments = [tournament];
  rows.teams = [];
  rows.courts = [];
  rows.matches = [];
  __resetRateLimiter();
});

describe("public state carries no codes", () => {
  it("GET /api/tournament/[id] omits control, board and organiser codes", async () => {
    const res = await GET(new Request(`http://x/api/tournament/${ID}`), {
      params: Promise.resolve({ id: ID }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.tournament.id).toBe(ID);
    expect(body.tournament).not.toHaveProperty("control_code");
    expect(body.tournament).not.toHaveProperty("board_code");
    expect(body.tournament).not.toHaveProperty("organiser_code");
    // belt and braces: the values appear nowhere in the payload
    for (const secret of ["402815", "KOLE-FR", "ABCD-EF"]) expect(text).not.toContain(secret);
  });
});

describe("attach returns only the codes the device proved it may have", () => {
  const post = (body: unknown) =>
    attach(
      new Request("http://x/api/attach", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" },
        body: JSON.stringify(body),
      }),
    );

  it("control code → control code, no board code", async () => {
    const body = await (await post({ controlCode: "402815" })).json();
    expect(body.tournament.control_code).toBe("402815");
    expect(body.tournament).not.toHaveProperty("board_code");
    expect(JSON.stringify(body)).not.toContain("ABCD-EF");
  });

  it("board code → control + board code (the board's codes overlay)", async () => {
    const body = await (await post({ boardCode: "kole fr" })).json();
    expect(body.tournament.control_code).toBe("402815");
    expect(body.tournament.board_code).toBe("KOLE-FR");
    expect(JSON.stringify(body)).not.toContain("ABCD-EF");
  });
});
