import { describe, it, expect } from "vitest";
import { matchesCsv, standingsCsv } from "@/lib/tournament/csv";
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
    id, tournament_id: "t", name, colour: "#fff", logo_url: null,
    seed: null, sort_order: 0, members: [], group_no: null,
  };
}
let mid = 0;
function match(home: string, away: string | null, h: number, a: number): Match {
  return {
    id: `m${mid++}`, tournament_id: "t", phase: "league", round: 1,
    bracket_slot: null, group_no: null, court_id: null, queue_order: mid,
    home_team_id: home, away_team_id: away,
    status: away === null ? "bye" : "done",
    result: away === null ? null : { home: h, away: a },
    winner_team_id: h > a ? home : a > h ? away : null,
    locked_by: null, result_by: null, result_version: 1, updated_at: "",
  };
}

const teams = [team("a", "Alfa"), team("b", "Bravo")];

describe("matchesCsv", () => {
  it("emits a header + one row per non-bye match", () => {
    const csv = matchesCsv(teams, [match("a", "b", 3, 1), match("a", null, 0, 0)], cfg);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Fase;Runde;Hjemmelag;Bortelag;Resultat;Vinner;Status");
    expect(lines).toHaveLength(2); // header + 1 (bye excluded)
    expect(lines[1]).toBe("league;1;Alfa;Bravo;3–1;Alfa;done");
  });

  it("escapes values containing the delimiter", () => {
    const csv = matchesCsv([team("a", "A;B"), team("b", "Bravo")], [match("a", "b", 1, 0)], cfg);
    expect(csv).toContain('"A;B"');
  });
});

describe("standingsCsv", () => {
  it("emits the standings table", () => {
    const s = computeStandings(teams, [match("a", "b", 2, 0)], cfg);
    const csv = standingsCsv(teams, s);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("#;Lag;K;S;U;T;For;Mot;±;P");
    expect(lines[1]).toContain("Alfa");
    expect(lines[1]).toContain(";3"); // 3 points
  });
});
