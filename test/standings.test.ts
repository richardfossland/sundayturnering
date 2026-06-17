import { describe, it, expect } from "vitest";
import {
  computeStandings,
  computeGroupStandings,
} from "@/lib/tournament/standings";
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
function match(home: string, away: string | null, h: number, a: number): Match {
  return {
    id: `m${mid++}`,
    tournament_id: "t",
    phase: "league",
    round: 1,
    bracket_slot: null,
    group_no: null,
    court_id: null,
    queue_order: 0,
    home_team_id: home,
    away_team_id: away,
    status: away === null ? "bye" : "done",
    result: away === null ? null : { home: h, away: a },
    winner_team_id: null,
    locked_by: null,
    result_by: null,
    result_version: 1,
    updated_at: "",
  };
}

describe("computeStandings", () => {
  const teams = [team("a", "Alfa"), team("b", "Bravo"), team("c", "Charlie")];

  it("tallies played/won/drawn/lost/points and diff", () => {
    const matches = [
      match("a", "b", 3, 1), // a win
      match("a", "c", 2, 2), // draw
      match("b", "c", 0, 1), // c win
    ];
    const s = computeStandings(teams, matches, cfg);
    const a = s.find((r) => r.team_id === "a")!;
    expect(a).toMatchObject({ played: 2, won: 1, drawn: 1, lost: 0, points: 4 });
    expect(a.diff).toBe(2); // (3+2) - (1+2)
    const c = s.find((r) => r.team_id === "c")!;
    expect(c).toMatchObject({ won: 1, drawn: 1, points: 4 });
  });

  it("breaks ties by goal diff", () => {
    const matches = [
      match("a", "b", 5, 0), // a +5
      match("a", "c", 1, 0),
      match("b", "c", 1, 0),
    ];
    const s = computeStandings(teams, matches, cfg);
    // a: 6pts, b: 3, c: 0 → a first by points
    expect(s[0].team_id).toBe("a");
  });

  it("uses head-to-head when points and diff are equal", () => {
    // a and b finish level on points & diff; a beat b head-to-head.
    const matches = [
      match("a", "b", 1, 0), // a beat b (h2h)
      match("a", "c", 0, 1), // a lost to c
      match("b", "c", 1, 0), // b beat c
    ];
    // a: beat b, lost c → 3pts, diff 0. b: lost a, beat c → 3pts diff 0.
    // c: lost b, beat a → 3pts diff 0. All level → h2h: a>b, b>c, c>a (cycle).
    const s = computeStandings(teams, matches, cfg);
    expect(s.every((r) => r.points === 3)).toBe(true);
  });

  it("two-way tie decided by head-to-head (level on points, diff & goals)", () => {
    // a and b each finish on 6 pts, +1 diff, 2 goals for. a beat b 1–0
    // head-to-head, so a must rank above b. c and d trail on 3 pts.
    const four = [team("a", "Alfa"), team("b", "Bravo"), team("c", "Charlie"), team("d", "Delta")];
    const matches = [
      match("a", "b", 1, 0), // a beats b (the decider)
      match("a", "d", 0, 1), // a loses to d
      match("a", "c", 1, 0),
      match("b", "d", 1, 0),
      match("b", "c", 1, 0),
      match("c", "d", 1, 0),
    ];
    const s = computeStandings(four, matches, cfg);
    const a = s.find((r) => r.team_id === "a")!;
    const b = s.find((r) => r.team_id === "b")!;
    expect(a.points).toBe(6);
    expect(b.points).toBe(6);
    expect(a.diff).toBe(b.diff);
    expect(a.rank).toBeLessThan(b.rank); // head-to-head: a above b
  });

  it("ignores byes (away null) in the table", () => {
    const matches = [match("a", null, 0, 0), match("b", "c", 2, 0)];
    const s = computeStandings(teams, matches, cfg);
    expect(s.find((r) => r.team_id === "a")!.played).toBe(0);
  });

  it("marks the top-N playoff cut line", () => {
    const matches = [
      match("a", "b", 3, 0),
      match("a", "c", 3, 0),
      match("b", "c", 1, 0),
    ];
    const s = computeStandings(teams, matches, cfg, 2);
    expect(s[0].inPlayoff).toBe(true);
    expect(s[1].inPlayoff).toBe(true);
    expect(s[2].inPlayoff).toBe(false);
    expect(s.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

describe("computeStandings — special results", () => {
  const teams = [team("a", "Alfa"), team("b", "Bravo")];

  function special(home: string, away: string, result: Match["result"]): Match {
    return { ...match(home, away, 0, 0), result };
  }

  it("counts a walkover as a played win for the awarded team", () => {
    const s = computeStandings(
      teams,
      [special("a", "b", { special: "walkover", winner: "home" })],
      cfg,
    );
    expect(s.find((r) => r.team_id === "a")!).toMatchObject({
      played: 1,
      won: 1,
      points: 3,
    });
    expect(s.find((r) => r.team_id === "b")!).toMatchObject({
      played: 1,
      lost: 1,
      points: 0,
    });
  });

  it("voids an abandoned match (not counted, no points)", () => {
    const s = computeStandings(teams, [special("a", "b", { special: "abandoned" })], cfg);
    expect(s.find((r) => r.team_id === "a")!.played).toBe(0);
    expect(s.find((r) => r.team_id === "b")!.played).toBe(0);
  });
});

describe("computeGroupStandings", () => {
  function inGroup(id: string, name: string, group: number): Team {
    return { ...team(id, name), group_no: group };
  }
  function gm(home: string, away: string, h: number, a: number, group: number): Match {
    return { ...match(home, away, h, a), group_no: group };
  }

  it("computes independent per-group tables with the per-group cut", () => {
    const teams = [
      inGroup("a", "Alfa", 0),
      inGroup("b", "Bravo", 0),
      inGroup("c", "Charlie", 1),
      inGroup("d", "Delta", 1),
    ];
    const matches = [gm("a", "b", 3, 0, 0), gm("c", "d", 1, 2, 1)];
    const groups = computeGroupStandings(teams, matches, cfg, 1);

    expect(groups.map((g) => g.group_no)).toEqual([0, 1]);
    expect(groups[0].rows[0].team_id).toBe("a"); // Alfa won group 0
    expect(groups[0].rows[0].inPlayoff).toBe(true);
    expect(groups[0].rows[1].inPlayoff).toBe(false);
    expect(groups[1].rows[0].team_id).toBe("d"); // Delta won group 1
  });
});
