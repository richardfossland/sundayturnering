import { describe, it, expect } from "vitest";
import {
  computeStandings,
  computeGroupStandings,
  resolveTiebreak,
  sanitiseTiebreak,
} from "@/lib/tournament/standings";
import type { Match, ScoringConfig, Team } from "@/lib/types";

const cfg: ScoringConfig = {
  profile: "simple",
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  allowDraw: true,
};

function team(id: string, name: string, group_no: number | null = null): Team {
  return {
    id, tournament_id: "t", name, colour: "#fff", logo_url: null,
    seed: null, sort_order: 0, members: [], group_no,
  };
}

let mid = 0;
function match(home: string, away: string, h: number, a: number, group_no: number | null = null): Match {
  return {
    id: `m${mid++}`, tournament_id: "t", phase: "league", round: 1,
    bracket_slot: null, group_no, court_id: null, queue_order: mid,
    scheduled_at: null, home_team_id: home, away_team_id: away,
    status: "done", result: { home: h, away: a }, winner_team_id: null,
    locked_by: null, result_by: null, result_version: 1, updated_at: "",
  };
}

const order = (rows: { team_id: string }[]) => rows.map((r) => r.team_id).join("");

describe("tiebreak: presets and validation", () => {
  it("default resolves to today's order; unknown falls back", () => {
    expect(resolveTiebreak(undefined)).toEqual(["points", "diff", "scored", "h2h_points", "name"]);
    expect(resolveTiebreak("nonsense" as never)).toEqual(resolveTiebreak("standard"));
    expect(resolveTiebreak(["wins", "name"])).toEqual(["wins", "name"]);
  });
  it("sanitiseTiebreak accepts presets/arrays, rejects the rest", () => {
    expect(sanitiseTiebreak(undefined)).toBeUndefined();
    expect(sanitiseTiebreak("uefa")).toBe("uefa");
    expect(sanitiseTiebreak(["points", "points", "name"])).toEqual(["points", "name"]);
    for (const bad of ["x", [], ["buchholz"], 3, {}, [1]]) expect(sanitiseTiebreak(bad)).toBe("invalid");
  });
});

describe("tiebreak: mini-league", () => {
  it("3-way cycle A>B, B>C, C>A resolved by diff in the mini-league", () => {
    const ts = [team("a", "A"), team("b", "B"), team("c", "C")];
    const m = [match("a", "b", 3, 0), match("b", "c", 1, 0), match("c", "a", 1, 0)];
    // all 3 pts; diff a +2, c 0, b -2
    expect(order(computeStandings(ts, m, cfg))).toBe("acb");
    expect(order(computeStandings(ts, m, cfg, 0, "uefa"))).toBe("acb");
  });

  it("uefa and standard differ on the same data", () => {
    const ts = [team("a", "A"), team("b", "B"), team("c", "C"), team("d", "D")];
    const m = [
      match("a", "b", 1, 0), match("b", "c", 1, 0), match("c", "a", 3, 0), // cycle
      match("a", "d", 9, 0), match("b", "d", 1, 0), match("c", "d", 1, 0),
    ];
    // 6 pts each for a,b,c. Overall diff: a +7, c +3, b +1.
    expect(order(computeStandings(ts, m, cfg, 0, "standard"))).toBe("acbd");
    expect(order(computeStandings(ts, m, cfg))).toBe("acbd"); // default = standard
    // Mini-league diff: c +2, b 0, a -2.
    expect(order(computeStandings(ts, m, cfg, 0, "uefa"))).toBe("cbad");
  });

  it("partial split re-tables the still-tied subgroup (recursion)", () => {
    const ts = [team("a", "A"), team("b", "B"), team("c", "C"), team("d", "D")];
    const m = [
      match("a", "b", 1, 0), match("a", "c", 1, 0), match("a", "d", 9, 0),
      match("b", "c", 1, 0), match("c", "d", 1, 0), match("d", "b", 5, 0),
    ];
    // Step 1 (h2h_points): A=9 splits off; B,C,D all 3.
    // Without recursion the 4-team h2h_diff would give c,d,b (c -1, d -3, b -5).
    // With recursion over {B,C,D} only: d +4, c 0, b -4.
    expect(order(computeStandings(ts, m, cfg, 0, ["h2h_points", "h2h_diff", "name"]))).toBe("adcb");
  });

  it("falls through to name (nb locale) when everything is level", () => {
    const ts = [team("x", "Øyvind"), team("y", "Åse"), team("z", "Ola")];
    expect(order(computeStandings(ts, [], cfg))).toBe("zxy");
  });

  it("wins criterion", () => {
    const ts = [team("a", "Zed"), team("b", "Abe"), team("c", "C"), team("d", "D")];
    const m = [
      match("a", "c", 1, 0), match("d", "a", 1, 0),
      match("b", "c", 0, 0), match("b", "d", 0, 0), match("b", "a", 0, 0),
    ];
    const rows = computeStandings(ts, m, cfg, 0, ["wins", "name"]);
    expect(order(rows).indexOf("a")).toBeLessThan(order(rows).indexOf("b")); // 1 win beats 0 despite name
  });
});

describe("tiebreak: groups", () => {
  it("passes the config through computeGroupStandings", () => {
    const ts = [team("a", "A", 1), team("b", "B", 1), team("c", "C", 1), team("d", "D", 1)];
    const m = [
      match("a", "b", 1, 0, 1), match("b", "c", 1, 0, 1), match("c", "a", 3, 0, 1),
      match("a", "d", 9, 0, 1), match("b", "d", 1, 0, 1), match("c", "d", 1, 0, 1),
    ];
    const std = computeGroupStandings(ts, m, cfg, 2);
    const uefa = computeGroupStandings(ts, m, cfg, 2, "uefa");
    expect(order(std[0].rows)).toBe("acbd");
    expect(order(uefa[0].rows)).toBe("cbad");
    expect(uefa[0].rows.filter((r) => r.inPlayoff).map((r) => r.team_id)).toEqual(["c", "b"]);
  });
});
