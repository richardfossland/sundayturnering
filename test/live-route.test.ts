import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, Tournament } from "@/lib/types";
import { validateLiveResult, canonicaliseLiveResult } from "@/lib/tournament/scoring";

const ID = "11111111-1111-1111-1111-111111111111";
const MID = "22222222-2222-2222-2222-222222222222";
let matchRow: Match;
let profile: Tournament["scoring"]["profile"] = "simple";
const updates: { patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];

vi.mock("@/lib/server/store", () => ({
  getTournament: async (): Promise<Tournament> => ({
    id: ID,
    control_code: "402815",
    board_code: "KOLE-FR",
    organiser_code: "ABCD-EF",
    organiser_id: null,
    title: "T",
    sport_label: "",
    format: "league",
    scoring: { profile, pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: false, setsBestOf: 5 },
    parallelism: "sequential",
    config: { playoffSize: 0, roundRobinDouble: false },
    status: "league",
    version: 0,
    timer: null,
    created_at: "",
  }),
  getMatch: async () => matchRow,
  db: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const rec = { patch, filters: [] as [string, unknown][] };
        updates.push(rec);
        const chain = {
          eq: (col: string, v: unknown) => {
            rec.filters.push([col, v]);
            return Object.assign(Promise.resolve({ error: null }), chain);
          },
        };
        return chain;
      },
    }),
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));

import { POST } from "@/app/api/match/live/route";

function makeMatch(over: Partial<Match> = {}): Match {
  return {
    id: MID, tournament_id: ID, phase: "league", round: 1, bracket_slot: null, group_no: null,
    court_id: null, queue_order: 0, home_team_id: "h", away_team_id: "a", status: "live",
    result: null, winner_team_id: null, locked_by: "d1|Bane 1", result_by: null,
    result_version: 0, updated_at: "", ...over,
  };
}
async function live(body: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost/api/match/live", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": `10.2.0.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ matchId: MID, deviceId: "d1", controlCode: "402815", ...body }),
    }),
  );
  return { status: res.status, json: await res.json() };
}

describe("POST /api/match/live", () => {
  beforeEach(() => {
    matchRow = makeMatch();
    profile = "simple";
    updates.length = 0;
  });

  it("requires the control code", async () => {
    const r = await live({ result: { home: 1, away: 0 }, controlCode: "000000" });
    expect(r.status).toBe(403);
    expect(updates).toEqual([]);
  });

  it("only a LIVE match takes an interim score", async () => {
    matchRow = makeMatch({ status: "done" });
    expect((await live({ result: { home: 1, away: 0 } })).json.error).toBe("kamp_ikke_live");
    matchRow = makeMatch({ status: "scheduled" });
    expect((await live({ result: { home: 1, away: 0 } })).status).toBe(409);
    expect(updates).toEqual([]);
  });

  it("writes the score guarded on status=live, never touching winner/version", async () => {
    const r = await live({ result: { home: 2, away: 2 } }); // a draw is fine mid-match
    expect(r.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({ result: { home: 2, away: 2 } });
    expect(updates[0].filters).toEqual([["id", MID], ["status", "live"]]);
  });

  it("rejects a special result and a winner-only profile", async () => {
    expect((await live({ result: { special: "walkover", winner: "home" } })).status).toBe(422);
    profile = "winner";
    expect((await live({ result: { home: 1, away: 0 } })).status).toBe(422);
    expect(updates).toEqual([]);
  });

  it("sets: recomputes the tally and allows a level set in progress", async () => {
    profile = "sets";
    const r = await live({ result: { sets: [[25, 20], [24, 24]], home: 9, away: 9 } });
    expect(r.status).toBe(200);
    expect(updates[0].patch).toEqual({ result: { sets: [[25, 20], [24, 24]], home: 1, away: 0 } });
  });
});

describe("validateLiveResult / canonicaliseLiveResult", () => {
  it("simple: ints ≥ 0, draws allowed, absurd values rejected", () => {
    expect(validateLiveResult("simple", { home: 0, away: 0 })).toBeNull();
    expect(validateLiveResult("simple", { home: 1.5, away: 0 })).not.toBeNull();
    expect(validateLiveResult("simple", { home: -1, away: 0 })).not.toBeNull();
    expect(validateLiveResult("simple", { home: 5000, away: 0 })).not.toBeNull();
  });
  it("sets: level sets count for nobody in the tally", () => {
    expect(validateLiveResult("sets", { sets: [[10, 10]] })).toBeNull();
    expect(canonicaliseLiveResult("sets", { sets: [[25, 23], [10, 10]] })).toEqual({ sets: [[25, 23], [10, 10]], home: 1, away: 0 });
    expect(validateLiveResult("sets", { sets: [] })).not.toBeNull();
  });
});
