import { describe, it, expect } from "vitest";
import { computeAwards } from "@/lib/tournament/awards";
import { computeStandings } from "@/lib/tournament/standings";
import type { Match, ScoringConfig, Team } from "@/lib/types";

const cfg: ScoringConfig = {
  profile: "simple",
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  allowDraw: true,
};

function team(id: string, name: string): Team {
  return {
    id,
    tournament_id: "t",
    name,
    colour: "#fff",
    logo_url: null,
    seed: null,
    sort_order: 0,
    members: [],
    group_no: null,
  };
}

let mid = 0;
function match(home: string, away: string, h: number, a: number): Match {
  return {
    id: `m${mid++}`,
    tournament_id: "t",
    phase: "league",
    round: 1,
    bracket_slot: null,
    group_no: null,
    court_id: null,
    queue_order: mid,
    home_team_id: home,
    away_team_id: away,
    status: "done",
    result: { home: h, away: a },
    winner_team_id: h > a ? home : a > h ? away : null,
    locked_by: null,
    result_by: null,
    result_version: 1,
    updated_at: "",
  };
}

describe("computeAwards", () => {
  const teams = [team("a", "Alfa"), team("b", "Bravo"), team("c", "Charlie")];
  const matches = [
    match("a", "b", 5, 0), // Alfa biggest win, also highest scoring tie
    match("a", "c", 2, 1), // Alfa wins again
    match("b", "c", 1, 1), // draw
  ];
  const standings = computeStandings(teams, matches, cfg);
  const awards = computeAwards(teams, matches, standings, cfg);

  const byKind = (k: string) => awards.find((x) => x.kind === k);

  it("names the table-topper as team of the night", () => {
    expect(byKind("team_of_night")?.teamId).toBe("a");
  });

  it("finds most wins", () => {
    const w = byKind("most_wins");
    expect(w?.teamId).toBe("a");
    expect(w?.detail).toContain("2");
  });

  it("finds the biggest win", () => {
    const b = byKind("biggest_win");
    expect(b?.teamId).toBe("a");
    expect(b?.detail).toBe("Alfa 5–0 Bravo");
  });

  it("finds the highest-scoring match", () => {
    expect(byKind("highest_scoring")?.detail).toBe("Alfa 5–0 Bravo");
  });

  it("finds best attack and best defense", () => {
    expect(byKind("best_attack")?.teamId).toBe("a"); // 7 scored
    expect(byKind("best_defense")).toBeTruthy();
  });

  it("skips score-based awards for the winner-only profile", () => {
    const wcfg: ScoringConfig = { ...cfg, profile: "winner", allowDraw: false };
    const wMatches = [
      { ...match("a", "b", 1, 0), result: { winner: "home" as const } },
      { ...match("a", "c", 1, 0), result: { winner: "home" as const } },
    ];
    const wStand = computeStandings(teams, wMatches, wcfg);
    const wAwards = computeAwards(teams, wMatches, wStand, wcfg);
    expect(wAwards.some((x) => x.kind === "most_wins")).toBe(true);
    expect(wAwards.some((x) => x.kind === "biggest_win")).toBe(false);
    expect(wAwards.some((x) => x.kind === "best_attack")).toBe(false);
  });
});

describe("standings form guide", () => {
  const teams = [team("a", "Alfa"), team("b", "Bravo")];
  it("records W/D/L in chronological order", () => {
    const matches = [match("a", "b", 3, 0), match("b", "a", 2, 2)];
    const s = computeStandings(teams, matches, cfg);
    expect(s.find((r) => r.team_id === "a")!.form).toEqual(["W", "D"]);
    expect(s.find((r) => r.team_id === "b")!.form).toEqual(["L", "D"]);
  });
});
