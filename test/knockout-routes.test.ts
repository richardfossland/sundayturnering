import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, Tournament } from "@/lib/types";

// Route seams for the knockout / status fixes:
//  - a level knockout score needs a decider, and the decider picks the winner;
//  - nothing is recorded once the tournament is finished, and league results
//    freeze once the playoff was seeded;
//  - changing a knockout WINNER after the next round was played: a referee is
//    refused, the organiser must confirm (cascade) before later matches reset.

const ID = "11111111-1111-1111-1111-111111111111";
const MID = "22222222-2222-2222-2222-222222222222";

let tournamentRow: Tournament;
let matchRow: Match;
let rpcArgs: Record<string, unknown> | null = null;
let downstreamPlayed = 0;
const resets: string[] = [];

vi.mock("@/lib/server/store", () => ({
  getTournament: async () => tournamentRow,
  getMatch: async () => matchRow,
  getMatches: async () => [],
  bumpVersion: async () => {},
  db: () => ({
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      rpcArgs = args;
      return { data: [{ ...matchRow, status: "done" }], error: null };
    },
    from: () => ({
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));
vi.mock("@/lib/server/playoff", () => ({
  propagateResult: async () => false,
  resetDownstream: async (_t: Tournament, id: string, opts?: { dryRun?: boolean }) => {
    if (!opts?.dryRun) resets.push(id);
    return downstreamPlayed;
  },
}));
vi.mock("@/lib/server/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/auth")>()),
  authOrganiserOrAdmin: async (_id: unknown, code: unknown) =>
    code === "ABCD-EF" ? tournamentRow : null,
}));

import { POST as result } from "@/app/api/match/result/route";
import { POST as lock } from "@/app/api/match/lock/route";
import { POST as correct } from "@/app/api/match/correct/route";
import { POST as override } from "@/app/api/organiser/override/route";
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
    config: { playoffSize: 0, roundRobinDouble: false },
    status: "playoff",
    version: 0,
    timer: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}
function match(over: Partial<Match> = {}): Match {
  return {
    id: MID,
    tournament_id: ID,
    phase: "playoff",
    round: 1,
    bracket_slot: 0,
    group_no: null,
    court_id: null,
    queue_order: 0,
    home_team_id: "h",
    away_team_id: "a",
    status: "live",
    result: null,
    winner_team_id: null,
    locked_by: null,
    result_by: null,
    result_version: 0,
    updated_at: new Date().toISOString(),
    ...over,
  };
}
function post(handler: (req: Request) => Promise<Response>, body: Record<string, unknown>) {
  return handler(
    new Request("http://localhost/api/x", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "10.1.1.1" },
      body: JSON.stringify(body),
    }),
  );
}
const ref = { matchId: MID, expectedVersion: 0, deviceId: "d1", controlCode: "402815" };

beforeEach(() => {
  tournamentRow = tournament();
  matchRow = match();
  rpcArgs = null;
  downstreamPlayed = 0;
  resets.length = 0;
  __resetRateLimiter();
});

describe("knockout result entry", () => {
  it("level score without a decider → 422, nothing written", async () => {
    const res = await post(result, { ...ref, result: { home: 1, away: 1 } });
    expect(res.status).toBe(422);
    expect(rpcArgs).toBeNull();
  });

  it("level score with a decider → saved with that team as winner", async () => {
    const res = await post(result, { ...ref, result: { home: 1, away: 1, decider: "away" } });
    expect(res.status).toBe(200);
    expect(rpcArgs?.p_winner_team_id).toBe("a");
    expect(rpcArgs?.p_result).toEqual({ home: 1, away: 1, decider: "away" });
  });
});

describe("status guards", () => {
  it("finished tournament: result and lock refused (unlock still allowed)", async () => {
    tournamentRow = tournament({ status: "finished" });
    expect((await post(result, { ...ref, result: { home: 2, away: 1 } })).status).toBe(409);
    const lockBase = { matchId: MID, deviceId: "d1", controlCode: "402815" };
    const locked = await post(lock, { ...lockBase, action: "lock" });
    expect(locked.status).toBe(409);
    expect((await locked.json()).error).toBe("turnering_avsluttet");
    expect((await post(lock, { ...lockBase, action: "unlock" })).status).toBe(200);
  });

  it("league result after the playoff was seeded → 409 serien_avsluttet", async () => {
    tournamentRow = tournament({ format: "league_playoff", status: "playoff" });
    matchRow = match({ phase: "league", status: "scheduled" });
    const res = await post(result, { ...ref, result: { home: 2, away: 1 } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("serien_avsluttet");
  });
});

describe("changing a knockout winner after the next round was played", () => {
  beforeEach(() => {
    matchRow = match({
      status: "done",
      result: { home: 2, away: 1 },
      winner_team_id: "h",
      result_by: "d1",
      updated_at: new Date().toISOString(),
    });
  });

  it("referee self-correct is refused", async () => {
    downstreamPlayed = 1;
    const res = await post(correct, { ...ref, result: { home: 1, away: 2 } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("neste_kamp_spilt");
    expect(rpcArgs).toBeNull();
  });

  it("referee may still fix the score when the winner is unchanged", async () => {
    downstreamPlayed = 1;
    const res = await post(correct, { ...ref, result: { home: 3, away: 1 } });
    expect(res.status).toBe(200);
  });

  it("organiser: 409 with the count first, resets only with cascade", async () => {
    downstreamPlayed = 2;
    const body = { tournamentId: ID, organiserCode: "ABCD-EF", matchId: MID, result: { home: 0, away: 3 } };
    const first = await post(override, body);
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ error: "neste_kamp_spilt", count: 2 });
    expect(resets).toEqual([]);

    const second = await post(override, { ...body, cascade: true });
    expect(second.status).toBe(200);
    expect(resets).toEqual([MID]);
  });

  it("organiser: nothing played downstream → no confirm needed", async () => {
    const res = await post(override, {
      tournamentId: ID,
      organiserCode: "ABCD-EF",
      matchId: MID,
      result: { home: 0, away: 3 },
    });
    expect(res.status).toBe(200);
    expect(resets).toEqual([]);
  });
});
