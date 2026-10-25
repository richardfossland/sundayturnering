import { describe, expect, it } from "vitest";
import { computeStandings, resolveTiebreak } from "@/lib/tournament/standings";
import { planSwissRound, swissProgress } from "@/lib/tournament/swiss";
import type { Match, ScoringConfig, Team } from "@/lib/types";

const cfg: ScoringConfig = { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: true };

function team(id: string, seed: number): Team {
  return {
    id, tournament_id: "t", name: id, colour: "#fff", logo_url: null,
    seed, sort_order: seed, members: [], group_no: null,
  };
}

let mid = 0;
function match(round: number, home: string, away: string | null, h = 0, a = 0): Match {
  return {
    id: `m${mid++}`, tournament_id: "t", phase: "league", round,
    bracket_slot: null, group_no: null, court_id: null, queue_order: mid,
    scheduled_at: null, called_at: null, home_team_id: home, away_team_id: away,
    status: away === null ? "bye" : "done",
    result: away === null ? null : { home: h, away: a },
    winner_team_id: away === null ? home : null,
    locked_by: null, result_by: null, result_version: 1, updated_at: "",
  };
}

const order = (rows: { team_id: string }[]) => rows.map((r) => r.team_id).join("");
const teams = ["A", "B", "C", "D"].map((id, i) => team(id, i + 1));

// Hånd-regnet eksempel (3/1/0 poeng):
//   R1: A–B 2–0, C–D 1–1   R2: A–C 1–0, B–D 3–1   R3: A–D 2–1, B–C 0–0
// Poeng:           A 9, B 4, C 2, D 1
// Buchholz:        A 4+2+1=7,  B 9+1+2=12, C 1+9+4=14, D 2+4+9=15
// Buchholz uten laveste: A 6, B 11, C 13, D 13
// Sonneborn-Berger: A 4+2+1=7, B 1+2/2=2, C 1/2+4/2=2.5, D 2/2=1
const games = [
  match(1, "A", "B", 2, 0), match(1, "C", "D", 1, 1),
  match(2, "A", "C", 1, 0), match(2, "B", "D", 3, 1),
  match(3, "A", "D", 2, 1), match(3, "B", "C", 0, 0),
];

describe("swiss-tiebreak", () => {
  it("Buchholz-verdier stemmer med håndregningen", () => {
    const rows = computeStandings(teams, games, cfg, 0, "swiss", { byeIsWin: true });
    const bu = Object.fromEntries(rows.map((r) => [r.team_id, r.buchholz]));
    expect(bu).toEqual({ A: 7, B: 12, C: 14, D: 15 });
    expect(rows.map((r) => r.points)).toEqual([9, 4, 2, 1]);
  });

  it("rekkefølge på ett kriterium (poeng som likt ellers): buchholz, cut1 og SB", () => {
    const by = (k: "buchholz" | "buchholz_cut1" | "sonneborn_berger") =>
      order(computeStandings(teams, games, cfg, 0, [k, "name"]));
    expect(by("buchholz")).toBe("DCBA"); // 15, 14, 12, 7
    expect(by("buchholz_cut1")).toBe("CDBA"); // 13, 13 (navn), 11, 6
    expect(by("sonneborn_berger")).toBe("ACBD"); // 7, 2.5, 2, 1
  });

  it("swiss-forvalget: poeng → buchholz → sonneborn_berger → h2h → diff → navn", () => {
    expect(resolveTiebreak("swiss")).toEqual(["points", "buchholz", "sonneborn_berger", "h2h_points", "diff", "name"]);
  });

  it("Buchholz avgjør likt på poeng", () => {
    // X og Y har begge 3 poeng, men X slo et sterkere lag.
    const t = ["P", "Q", "X", "Y"].map((id, i) => team(id, i + 1));
    const g = [
      match(1, "P", "Q", 1, 0),
      match(1, "X", "Y", 1, 0), // X 3, Y 0
      match(2, "P", "X", 1, 0), // P 6, X 3
      match(2, "Y", "Q", 1, 0), // Y 3, Q 0
    ];
    // X møtte Y(3)+P(6)=9; Y møtte X(3)+Q(0)=3 → X foran Y selv om navnet tilsier motsatt rekkefølge.
    const rows = computeStandings(t, g, cfg, 0, "swiss");
    expect(rows.find((r) => r.team_id === "X")!.rank).toBeLessThan(rows.find((r) => r.team_id === "Y")!.rank);
  });
});

describe("swiss-bye", () => {
  it("bye gir seier og poeng i Swiss, men teller ikke uten byeIsWin", () => {
    const t = ["A", "B", "C"].map((id, i) => team(id, i + 1));
    const g = [match(1, "A", "B", 1, 0), match(1, "C", null)];
    const sw = computeStandings(t, g, cfg, 0, "swiss", { byeIsWin: true });
    const c = sw.find((r) => r.team_id === "C")!;
    expect([c.played, c.won, c.points, c.diff, c.buchholz]).toEqual([1, 1, 3, 0, 0]);
    expect(c.form).toEqual(["W"]);
    const lg = computeStandings(t, g, cfg, 0);
    expect(lg.find((r) => r.team_id === "C")!.points).toBe(0);
  });
});

describe("planSwissRound og swissProgress", () => {
  it("runde 1 etter seed, runde 2 etter tabellen uten omkamp; bye får poeng i tabellen", () => {
    const t = ["A", "B", "C", "D", "E"].map((id, i) => team(id, i + 1));
    const r1 = planSwissRound(t, [], cfg, "swiss");
    expect(r1).toEqual([
      { homeId: "A", awayId: "C" },
      { homeId: "B", awayId: "D" },
      { homeId: "E", awayId: null },
    ]);
    const played = [match(1, "A", "C", 1, 0), match(1, "B", "D", 0, 2), match(1, "E", null)];
    const r2 = planSwissRound(t, played, cfg, "swiss");
    const key = (a: string, b: string) => [a, b].sort().join("");
    const met = new Set(["AC", "BD"]);
    for (const p of r2) if (p.awayId) expect(met.has(key(p.homeId, p.awayId))).toBe(false);
    const bye = r2.find((p) => p.awayId === null)!;
    expect(bye.homeId).not.toBe("E"); // E har allerede hatt bye
    // A, D og E har 3 poeng: bye skal ikke gå til noen av dem (høyt rangert), men til laveste uten bye.
    expect(["B", "C"]).toContain(bye.homeId);
  });

  it("swissProgress: åpen runde, ferdig runde, ferdig turnering", () => {
    const open: Match = { ...match(1, "A", "B"), status: "live", result: null };
    expect(swissProgress([open, match(1, "C", null)], 3)).toMatchObject({ round: 1, open: 1, complete: false, finished: false });
    expect(swissProgress([match(1, "A", "B", 1, 0)], 3)).toMatchObject({ round: 1, open: 0, complete: true, finished: false });
    expect(swissProgress([match(1, "A", "B", 1, 0), match(2, "A", "C", 1, 0)], 2)).toMatchObject({ round: 2, finished: true });
    expect(swissProgress([], 3)).toMatchObject({ round: 0, complete: false });
  });
});
