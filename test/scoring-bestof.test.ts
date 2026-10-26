import { describe, it, expect } from "vitest";
import {
  validateResult,
  checkSetsBestOf,
  resolve,
  leaguePoints,
  setsToWin,
  MAX_SETS,
} from "@/lib/tournament/scoring";
import { computeStandings } from "@/lib/tournament/standings";
import type { Match, ScoringConfig, Team } from "@/lib/types";

// C4: «best av N» was never checked for sets — best of 3 accepted 5–0, 3–2 or a
// single set as a finished match, which also skewed the set difference.
// C9: a walkover always counted 1–0, also where a normal win is 3–0.

const cfg = (bestOf?: number): ScoringConfig => ({
  profile: "sets",
  setsBestOf: bestOf,
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  allowDraw: false,
});
const W: [number, number] = [25, 20]; // home wins the set
const L: [number, number] = [20, 25]; // away wins the set
const v = (sets: [number, number][], bestOf?: number) => validateResult("sets", { sets }, cfg(bestOf));

describe("setsToWin", () => {
  it("is ceil(N/2)", () => {
    expect([1, 3, 5, 7].map(setsToWin)).toEqual([1, 2, 3, 4]);
  });
});

describe("best of 3", () => {
  it("accepts 2–0 and 2–1 (either side)", () => {
    expect(v([W, W], 3)).toBeNull();
    expect(v([W, L, W], 3)).toBeNull();
    expect(v([L, L], 3)).toBeNull();
    expect(v([L, W, L], 3)).toBeNull();
  });
  it("rejects a single set as a finished match", () => {
    expect(v([W], 3)).toMatch(/ikke avgjort/);
  });
  it("rejects 3–0 / 3–2 (too many sets for the format)", () => {
    expect(v([W, W, W], 3)).toMatch(/avgjort etter sett 2/);
    expect(v([W, L, W, L, W], 3)).toBeTruthy();
  });
  it("rejects a set played after the match was decided", () => {
    expect(v([W, W, L], 3)).toMatch(/Fjern sett 3/);
  });
  it("rejects a level count (1–1)", () => {
    expect(v([W, L], 3)).toBeTruthy();
  });
});

describe("best of 5", () => {
  it("needs exactly 3 sets for the winner", () => {
    expect(v([W, W], 5)).toMatch(/ikke avgjort/);
    expect(v([W, W, W], 5)).toBeNull();
    expect(v([W, L, W, L, W], 5)).toBeNull();
  });
  it("rejects 4–0 and sets after the decider", () => {
    expect(v([W, W, W, W], 5)).toMatch(/Fjern sett 4/);
    expect(v([W, W, W, L, L], 5)).toBeTruthy();
  });
});

describe("without a configured N (old tournaments) and the hard cap", () => {
  it("keeps the old behaviour", () => {
    expect(v([W], undefined)).toBeNull();
    expect(checkSetsBestOf([W, W, W, W], undefined)).toBeNull();
  });
  it("caps the number of sets", () => {
    const many = Array.from({ length: MAX_SETS + 1 }, (_, i) => (i % 2 ? L : W));
    expect(v(many, undefined)).toBe("For mange sett.");
  });
});

describe("special results are untouched", () => {
  it("walkover needs no sets", () => {
    expect(validateResult("sets", { special: "walkover", winner: "home" }, cfg(3))).toBeNull();
  });
});

describe("walkover score is profile aware (C9)", () => {
  it("sets best of 3 → 2–0, best of 5 → 3–0", () => {
    expect(resolve("sets", { special: "walkover", winner: "home" }, cfg(3))).toMatchObject({
      homeScore: 2,
      awayScore: 0,
    });
    expect(resolve("sets", { special: "disqualification", winner: "away" }, cfg(5))).toMatchObject({
      homeScore: 0,
      awayScore: 3,
    });
  });
  it("sets without N → best of 3", () => {
    expect(resolve("sets", { special: "walkover", winner: "home" }, cfg(undefined)).homeScore).toBe(2);
  });
  it("simple stays 1–0, an explicit walkoverScore wins", () => {
    const simple: ScoringConfig = { ...cfg(), profile: "simple" };
    expect(resolve("simple", { special: "walkover", winner: "home" }, simple).homeScore).toBe(1);
    expect(
      resolve("sets", { special: "walkover", winner: "home" }, { ...cfg(5), walkoverScore: [3, 1] }),
    ).toMatchObject({ homeScore: 3, awayScore: 1 });
  });
  it("still gives the winner the league points", () => {
    expect(leaguePoints({ special: "walkover", winner: "away" }, "sets", cfg(3))).toEqual({ home: 0, away: 3 });
  });
  it("feeds the set difference in the table like a straight-sets win", () => {
    const teams = ["a", "b"].map((id) => ({ id, name: id, colour: "#000", seed: 1 })) as unknown as Team[];
    const m = {
      id: "m1",
      tournament_id: "t",
      phase: "league",
      round: 1,
      home_team_id: "a",
      away_team_id: "b",
      status: "done",
      result: { special: "walkover", winner: "home" },
      winner_team_id: "a",
    } as unknown as Match;
    const rows = computeStandings(teams, [m], cfg(5), 0);
    const a = rows.find((r) => r.team_id === "a")!;
    expect(a.diff).toBe(3);
  });
});
