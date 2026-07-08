import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match } from "@/lib/types";

// propagateResult (lib/server/playoff.ts) now delegates the whole bracket
// propagation step to a single Postgres RPC (`propagate_playoff_result`,
// migration 0009) so it is transactional + idempotent server-side — that part
// can only be verified against a real Postgres instance (this repo has no
// db-test harness; see docs/DEPLOY.md + the PR description for the manual
// verification steps run against a live Supabase project).
//
// What we CAN cover here, without a database, is the client-side contract:
//   - the RPC is called with the right match id, and its `finished` flag is
//     surfaced as the return value;
//   - a non-playoff / unresolved match never calls the RPC at all;
//   - when the RPC is not deployed yet (PGRST202 — "function not found in the
//     schema cache"), the call transparently falls back to the pre-migration
//     multi-write path, so this file works regardless of migration-vs-deploy
//     order;
//   - any OTHER RPC error is surfaced (thrown) instead of being silently
//     swallowed, since a genuinely failed propagation must not look like
//     success to the caller.

type FakeCall = { table: string; op: "select" | "update"; payload?: unknown; eq: [string, unknown][] };

let rpcName: string | undefined;
let rpcArgs: Record<string, unknown> | undefined;
let rpcResult: { data: unknown; error: { code?: string; message?: string } | null };
let calls: FakeCall[];
let bumpedIds: string[];

function makeChain(table: string, op: "select" | "update", payload: unknown, resolve: unknown) {
  const call: FakeCall = { table, op, payload, eq: [] };
  calls.push(call);
  const chain = {
    eq(col: string, val: unknown) {
      call.eq.push([col, val]);
      return chain;
    },
    then(onFulfilled: (v: unknown) => unknown) {
      return Promise.resolve(resolve).then(onFulfilled);
    },
  };
  return chain;
}

vi.mock("@/lib/server/store", () => ({
  db: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcName = name;
      rpcArgs = args;
      return Promise.resolve(rpcResult);
    },
    from: (table: string) => ({
      select: () => makeChain(table, "select", undefined, { data: [], error: null }),
      update: (payload: unknown) => makeChain(table, "update", payload, { data: null, error: null }),
    }),
  }),
  bumpVersion: (id: string) => {
    bumpedIds.push(id);
    return Promise.resolve();
  },
  getMatches: vi.fn(),
  getTeams: vi.fn(),
}));

import { propagateResult } from "@/lib/server/playoff";

function makeMatch(over: Partial<Match> = {}): Match {
  return {
    id: "m1",
    tournament_id: "t1",
    phase: "playoff",
    round: 2,
    bracket_slot: 0,
    group_no: null,
    court_id: null,
    queue_order: 0,
    home_team_id: "teamA",
    away_team_id: "teamB",
    status: "done",
    result: { home: 3, away: 1 },
    winner_team_id: "teamA",
    locked_by: null,
    result_by: null,
    result_version: 1,
    updated_at: "",
    ...over,
  };
}

describe("propagateResult", () => {
  beforeEach(() => {
    rpcName = undefined;
    rpcArgs = undefined;
    rpcResult = { data: [{ finished: true, propagated: true }], error: null };
    calls = [];
    bumpedIds = [];
  });

  it("skips the RPC entirely for a non-playoff match", async () => {
    const finished = await propagateResult(makeMatch({ phase: "league" }));
    expect(finished).toBe(false);
    expect(rpcName).toBeUndefined();
  });

  it("skips the RPC entirely when the match has no winner", async () => {
    const finished = await propagateResult(makeMatch({ winner_team_id: null }));
    expect(finished).toBe(false);
    expect(rpcName).toBeUndefined();
  });

  it("calls propagate_playoff_result with the match id and returns its `finished` flag", async () => {
    rpcResult = { data: [{ finished: true, propagated: true }], error: null };
    const finished = await propagateResult(makeMatch({ id: "final-match" }));
    expect(rpcName).toBe("propagate_playoff_result");
    expect(rpcArgs).toEqual({ p_match_id: "final-match" });
    expect(finished).toBe(true);
  });

  it("returns false when the RPC reports the bracket is not finished (e.g. a semifinal)", async () => {
    rpcResult = { data: [{ finished: false, propagated: true }], error: null };
    const finished = await propagateResult(makeMatch({ bracket_slot: 1 }));
    expect(finished).toBe(false);
  });

  it("returns false on a no-op duplicate call (propagated=false) without treating it as an error", async () => {
    rpcResult = { data: [{ finished: false, propagated: false }], error: null };
    const finished = await propagateResult(makeMatch());
    expect(finished).toBe(false);
  });

  it("handles a bare-object RPC response (not array-wrapped)", async () => {
    rpcResult = { data: { finished: true, propagated: true }, error: null };
    const finished = await propagateResult(makeMatch());
    expect(finished).toBe(true);
  });

  it("falls back to the legacy multi-write path when the RPC is not deployed (PGRST202)", async () => {
    rpcResult = { data: null, error: { code: "PGRST202", message: "function not found" } };
    const finished = await propagateResult(
      makeMatch({ id: "semi", winner_team_id: "teamA", bracket_slot: 1 }),
    );
    // Fell through to the fallback: it reads bracket_links then bumps the
    // tournament version, same as the pre-migration code path.
    expect(calls.some((c) => c.table === "bracket_links" && c.op === "select")).toBe(true);
    expect(bumpedIds).toEqual(["t1"]);
    // No outgoing links in this fixture (empty bracket_links) + bracket_slot 1
    // is not the final → not finished.
    expect(finished).toBe(false);
  });

  it("throws on an unexpected RPC error instead of silently swallowing it", async () => {
    rpcResult = { data: null, error: { code: "500", message: "boom" } };
    await expect(propagateResult(makeMatch())).rejects.toBeTruthy();
  });
});
