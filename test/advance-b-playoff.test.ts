import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, Team, Tournament } from "@/lib/types";

// advanceToPlayoff: «B-sluttspill for resten» — lagene under grensen blir
// seedet etter tabellen (liga) eller krysseedet gruppevis (gruppespill), og
// sendt til byggeren som bSeeds. Uten valget sendes ingen bSeeds.

let teams: Team[] = [];
let matches: Match[] = [];
let built: { seeds: string[]; opts: { bSeeds?: string[] } } | null = null;

function chain(data: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "update", "delete", "order"]) c[m] = () => c;
  c.then = (res: (v: unknown) => unknown) => res({ data, error: null });
  return c;
}
vi.mock("@/lib/server/store", () => ({
  db: () => ({ from: (t: string) => chain(t === "courts" ? [] : [{ id: "t" }]) }),
  getTeams: async () => teams,
  getMatches: async () => matches,
  bumpVersion: async () => {},
}));
vi.mock("@/lib/server/build", () => ({
  buildCupMatches: async (_t: string, seeds: string[], _c: string[], opts: { bSeeds?: string[] }) => {
    built = { seeds, opts };
  },
}));

import { advanceToPlayoff } from "@/lib/server/playoff";

const team = (id: string, group_no: number | null = null): Team => ({
  id, tournament_id: "t", name: id, colour: "#000", logo_url: null, seed: null, sort_order: 0, members: [], group_no,
});
let n = 0;
/** Ferdig ligakamp der `home` slår `away` 1–0. */
const win = (home: string, away: string, group_no: number | null = null): Match =>
  ({
    id: `m${n++}`, tournament_id: "t", phase: "league", round: 1, bracket_slot: null, group_no, court_id: null,
    queue_order: 0, scheduled_at: null, called_at: null, home_team_id: home, away_team_id: away, status: "done",
    result: { home: 1, away: 0 }, winner_team_id: home, locked_by: null, result_by: null, result_version: 1, updated_at: "",
  }) as Match;

function tournament(over: Partial<Tournament>): Tournament {
  return {
    id: "t", control_code: "1", board_code: "b", organiser_code: "o", organiser_id: null, title: "", sport_label: "",
    format: "league_playoff",
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: false },
    parallelism: "sequential", config: { playoffSize: 4, roundRobinDouble: false }, status: "league", version: 0,
    timer: null, created_at: "", ...over,
  };
}

beforeEach(() => {
  built = null;
  n = 0;
});

describe("advanceToPlayoff med B-sluttspill", () => {
  // Rangering = rekkefølge: s1 slår alle, s2 slår alle under, osv.
  const ranked = ["s1", "s2", "s3", "s4", "s5", "s6"];
  const league = () => {
    const out: Match[] = [];
    for (let i = 0; i < ranked.length; i++)
      for (let j = i + 1; j < ranked.length; j++) out.push(win(ranked[i], ranked[j]));
    return out;
  };

  it("liga: topp 4 til A, resten i tabellrekkefølge til B", async () => {
    teams = ranked.map((id) => team(id));
    matches = league();
    await advanceToPlayoff(tournament({ config: { playoffSize: 4, roundRobinDouble: false, consolation: "b_playoff" } }));
    expect(built!.seeds).toEqual(["s1", "s2", "s3", "s4"]);
    expect(built!.opts.bSeeds).toEqual(["s5", "s6"]);
  });

  it("uten valget sendes ingen bSeeds", async () => {
    teams = ranked.map((id) => team(id));
    matches = league();
    await advanceToPlayoff(tournament({}));
    expect(built!.opts.bSeeds).toBeUndefined();
  });

  it("bare ett lag igjen under grensen → ingen B", async () => {
    teams = ranked.slice(0, 5).map((id) => team(id));
    matches = league().filter((m) => m.home_team_id !== "s6" && m.away_team_id !== "s6");
    await advanceToPlayoff(tournament({ config: { playoffSize: 4, roundRobinDouble: false, consolation: "b_playoff" } }));
    expect(built!.opts.bSeeds).toBeUndefined();
  });

  it("gruppespill: de som falt ut krysseedes (gruppe A først)", async () => {
    teams = [team("a1", 0), team("a2", 0), team("a3", 0), team("b1", 1), team("b2", 1), team("b3", 1), team("b4", 1)];
    matches = [
      win("a1", "a2", 0), win("a1", "a3", 0), win("a2", "a3", 0),
      win("b1", "b2", 1), win("b1", "b3", 1), win("b1", "b4", 1), win("b2", "b3", 1), win("b2", "b4", 1), win("b3", "b4", 1),
    ];
    await advanceToPlayoff(
      tournament({
        format: "group_playoff",
        config: { playoffSize: 0, roundRobinDouble: false, groupCount: 2, advancePerGroup: 2, consolation: "b_playoff" },
      }),
    );
    expect(built!.seeds).toEqual(["a1", "b1", "a2", "b2"]);
    expect(built!.opts.bSeeds).toEqual(["a3", "b3", "b4"]);
  });
});
