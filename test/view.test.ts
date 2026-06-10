import { describe, it, expect } from "vitest";
import { championId, finalRanking } from "@/lib/client/view";
import type { StateDTO, TournamentDTO } from "@/lib/dto";
import type { Match, StandingRow, Team } from "@/lib/types";

function team(id: string, name: string, seed?: number): Team {
  return {
    id,
    tournament_id: "t",
    name,
    colour: "#888",
    logo_url: null,
    seed: seed ?? null,
    sort_order: 0,
    members: [],
  };
}
function standing(team_id: string, rank: number, played = 1): StandingRow {
  return {
    team_id,
    played,
    won: 0,
    drawn: 0,
    lost: 0,
    points: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    diff: 0,
    rank,
    inPlayoff: false,
  };
}
let mid = 0;
function pmatch(round: number, home: string | null, away: string | null, winner: string | null): Match {
  return {
    id: `m${mid++}`,
    tournament_id: "t",
    phase: "playoff",
    round,
    bracket_slot: 0,
    court_id: null,
    queue_order: 0,
    home_team_id: home,
    away_team_id: away,
    status: winner ? "done" : "scheduled",
    result: null,
    winner_team_id: winner,
    locked_by: null,
    result_version: winner ? 1 : 0,
    updated_at: "",
  };
}
function state(p: Partial<StateDTO>): StateDTO {
  return {
    tournament: { format: "league" } as TournamentDTO,
    teams: [],
    courts: [],
    matches: [],
    standings: [],
    ...p,
  };
}

describe("championId", () => {
  it("league: rank-1 standing once matches are played", () => {
    const s = state({
      teams: [team("a", "A"), team("b", "B")],
      standings: [standing("a", 1), standing("b", 2)],
    });
    expect(championId(s)).toBe("a");
  });
  it("null when nothing played", () => {
    const s = state({
      teams: [team("a", "A")],
      standings: [standing("a", 1, 0)],
    });
    expect(championId(s)).toBeNull();
  });
  it("playoff: winner of the final (highest round, done)", () => {
    const s = state({
      teams: [team("a", "A"), team("b", "B")],
      matches: [pmatch(1, "a", "b", "b")],
      standings: [standing("a", 1), standing("b", 2)],
    });
    // bracket final winner beats league rank-1
    expect(championId(s)).toBe("b");
  });
});

describe("finalRanking", () => {
  it("league: standings order, champion first", () => {
    const s = state({
      teams: [team("a", "A"), team("b", "B"), team("c", "C")],
      standings: [standing("a", 1), standing("b", 2), standing("c", 3)],
    });
    expect(finalRanking(s).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("pure cup: champion first, later elimination ranks higher", () => {
    // 4-team cup: a beats b (r1), c beats d (r1), a beats c (final r2)
    const s = state({
      tournament: { format: "cup" } as TournamentDTO,
      teams: [team("a", "A", 1), team("b", "B", 2), team("c", "C", 3), team("d", "D", 4)],
      matches: [
        pmatch(1, "a", "b", "a"),
        pmatch(1, "c", "d", "c"),
        pmatch(2, "a", "c", "a"),
      ],
    });
    const order = finalRanking(s).map((t) => t.id);
    expect(order[0]).toBe("a"); // champion
    expect(order[1]).toBe("c"); // lost in the final (round 2)
    // b and d lost in round 1 → ranked below c
    expect(order.slice(2).sort()).toEqual(["b", "d"]);
  });

  it("empty state → all teams returned (no crash)", () => {
    const s = state({ teams: [team("a", "A"), team("b", "B")] });
    expect(finalRanking(s)).toHaveLength(2);
  });
});
