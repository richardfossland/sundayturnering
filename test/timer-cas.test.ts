import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tournament } from "@/lib/types";

// «+1:00» is read-modify-write; it must be a compare-and-set on the old
// endsAt, retry once on a miss, then 409.

const ID = "11111111-1111-1111-1111-111111111111";
const END = "2030-01-01T00:00:00.000Z";
let tRow: Tournament;
let results: number[]; // affected rows per update attempt
const conds: string[][] = [];

vi.mock("@/lib/server/store", () => ({
  getTournament: async () => tRow,
  bumpVersion: async () => {},
  db: () => ({
    rpc: async () => ({ data: false, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { timer: tRow.timer }, error: null }) }),
      }),
      update: () => {
        const c: string[] = [];
        const q: Record<string, unknown> = {
          eq: (col: string, v: unknown) => (c.push(`eq:${col}:${v}`), q),
          is: (col: string, v: unknown) => (c.push(`is:${col}:${v}`), q),
          select: async () => {
            conds.push(c);
            const n = results.shift() ?? 0;
            return { data: Array.from({ length: n }, () => ({ id: ID })), error: null };
          },
          then: (res: (v: unknown) => void) => res({ error: null }),
        };
        return q;
      },
    }),
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));

import { POST } from "@/app/api/match/timer/route";
import { __resetRateLimiter } from "@/lib/server/http";

function post(action: string) {
  return POST(
    new Request("http://localhost/api/match/timer", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "10.2.2.2" },
      body: JSON.stringify({ tournamentId: ID, action, controlCode: "402815" }),
    }),
  );
}

beforeEach(() => {
  __resetRateLimiter();
  conds.length = 0;
  tRow = {
    id: ID, control_code: "402815", board_code: "K", organiser_code: "A", organiser_id: null,
    title: "T", sport_label: "", format: "league",
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: false },
    parallelism: "sequential", config: { playoffSize: 0, roundRobinDouble: false },
    status: "league", version: 0,
    timer: { endsAt: END, durationSec: 300, running: true },
    created_at: "",
  };
});

describe("match timer add — compare-and-set", () => {
  it("writes conditioned on the old endsAt", async () => {
    results = [1];
    const res = await post("add");
    expect(res.status).toBe(200);
    expect(conds[0]).toContain(`eq:timer->>endsAt:${END}`);
  });

  it("retries once after a miss, then succeeds", async () => {
    results = [0, 1];
    expect((await post("add")).status).toBe(200);
    expect(conds).toHaveLength(2);
  });

  it("still losing after the retry → 409 konflikt", async () => {
    results = [0, 0];
    const res = await post("add");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("konflikt");
  });

  it("start is a plain overwrite (no CAS)", async () => {
    results = [];
    expect((await post("start")).status).toBe(200);
    expect(conds).toHaveLength(0);
  });
});
