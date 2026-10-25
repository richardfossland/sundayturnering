import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Match, Team, Tournament } from "@/lib/types";

// POST /api/organiser/advance for format 'swiss': neste runde bare når forrige er
// ferdig (ellers 409), og to samtidige kall legger samme runde bare én gang
// (CAS på tournaments.version).

const ID = "11111111-1111-1111-1111-111111111111";

let row: Tournament;
let matchRows: Match[];
let teamRows: Team[];
let version: number;
let bumped = 0;

vi.mock("@/lib/supabase/auth-server", () => ({
  createAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));
vi.mock("@/lib/server/playoff", () => ({ advanceToPlayoff: async () => {}, reopenTournament: async () => "league" }));
vi.mock("@/lib/server/store", () => ({
  getTournament: async () => ({ ...row, version }),
  getMatches: async () => matchRows,
  getTeams: async () => teamRows,
  bumpVersion: async () => {
    bumped++;
    version++;
  },
  db: () => ({
    from: (table: string) => {
      if (table === "tournaments")
        return {
          update: (patch: { version: number }) => ({
            eq: () => ({
              eq: (_c: string, v: number) => ({
                // CAS: bare den som leser gjeldende versjon får den.
                select: async () => {
                  if (v !== version) return { data: [], error: null };
                  version = patch.version;
                  return { data: [{ id: ID }], error: null };
                },
              }),
            }),
          }),
        };
      if (table === "matches")
        return {
          insert: async (rows: Partial<Match>[]) => {
            for (const r of rows) matchRows.push({ id: `n${matchRows.length}`, status: "scheduled", ...r } as Match);
            return { error: null };
          },
        };
      return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
    },
  }),
}));

import { POST as advance } from "@/app/api/organiser/advance/route";
import { __resetRateLimiter } from "@/lib/server/http";

function mk(round: number, home: string, away: string | null, status: Match["status"] = "done"): Match {
  return {
    id: `m${round}${home}`, tournament_id: ID, phase: "league", round, bracket_slot: null, group_no: null,
    court_id: null, queue_order: round * 10, scheduled_at: null, called_at: null,
    home_team_id: home, away_team_id: away, status,
    result: status === "done" ? { home: 1, away: 0 } : null,
    winner_team_id: away === null ? home : null,
    locked_by: null, result_by: null, result_version: 0, updated_at: "",
  };
}

const post = () =>
  advance(
    new Request("http://x/api/organiser/advance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tournamentId: ID, organiserCode: "ABCD-EF" }),
    }),
  );

beforeEach(() => {
  __resetRateLimiter();
  bumped = 0;
  version = 5;
  teamRows = ["A", "B", "C", "D"].map((id, i) => ({
    id, tournament_id: ID, name: id, colour: "#fff", logo_url: null, seed: i + 1, sort_order: i, members: [], group_no: null,
  }));
  row = {
    id: ID, control_code: "402815", board_code: "KOLE-FR", organiser_code: "ABCD-EF", organiser_id: null,
    title: "T", sport_label: "", format: "swiss",
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: true },
    parallelism: "sequential", config: { playoffSize: 0, roundRobinDouble: false, swiss: { rounds: 2 }, tiebreak: "swiss" },
    status: "league", version: 5, timer: null, created_at: new Date().toISOString(),
  };
  matchRows = [mk(1, "A", "C"), mk(1, "B", "D")];
});

describe("advance (swiss)", () => {
  it("uferdig runde → 409 runden_pagar", async () => {
    matchRows = [mk(1, "A", "C"), mk(1, "B", "D", "live")];
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "runden_pagar", count: 1 });
    expect(matchRows).toHaveLength(2);
  });

  it("ferdig runde → neste runde legges, uten omkamp og med videre kø-rekkefølge", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, round: 2 });
    const r2 = matchRows.filter((m) => m.round === 2);
    expect(r2).toHaveLength(2);
    for (const m of r2) expect(["AC", "BD"]).not.toContain([m.home_team_id, m.away_team_id].sort().join(""));
    expect(Math.min(...r2.map((m) => m.queue_order))).toBeGreaterThan(10);
    expect(bumped).toBe(1);
  });

  it("dobbel advance: to samtidige kall legger bare én runde", async () => {
    const [a, b] = await Promise.all([post(), post()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(matchRows.filter((m) => m.round === 2)).toHaveLength(2);
  });

  it("dobbel advance etter hverandre: runde 2 er åpen → 409", async () => {
    expect((await post()).status).toBe(200);
    const again = await post();
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("runden_pagar");
    expect(matchRows.filter((m) => m.round === 2)).toHaveLength(2);
  });

  it("siste runde ferdig → 409 alle_runder_spilt", async () => {
    matchRows = [mk(1, "A", "C"), mk(1, "B", "D"), mk(2, "A", "B"), mk(2, "C", "D")];
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("alle_runder_spilt");
  });

  it("avsluttet turnering → 409", async () => {
    row = { ...row, status: "finished" };
    expect((await post()).status).toBe(409);
  });
});
