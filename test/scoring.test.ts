import { describe, it, expect } from "vitest";
import {
  resolve,
  leaguePoints,
  validateResult,
  defaultScoringConfig,
  isVoid,
} from "@/lib/tournament/scoring";
import type { ScoringConfig } from "@/lib/types";

const simpleCfg: ScoringConfig = {
  profile: "simple",
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  allowDraw: true,
};
const setsCfg: ScoringConfig = { ...simpleCfg, profile: "sets", setsBestOf: 5 };
const winnerCfg: ScoringConfig = { ...simpleCfg, profile: "winner", allowDraw: false };

describe("simple profile", () => {
  it("resolves winner + display", () => {
    expect(resolve("simple", { home: 3, away: 1 })).toMatchObject({
      winner: "home",
      display: "3–1",
      homeScore: 3,
      awayScore: 1,
    });
  });
  it("draw → 1 point each when allowed", () => {
    expect(resolve("simple", { home: 2, away: 2 }).winner).toBe("draw");
    expect(leaguePoints({ home: 2, away: 2 }, "simple", simpleCfg)).toEqual({
      home: 1,
      away: 1,
    });
  });
  it("win → 3/0", () => {
    expect(leaguePoints({ home: 3, away: 1 }, "simple", simpleCfg)).toEqual({
      home: 3,
      away: 0,
    });
  });
  it("rejects draw when allowDraw is false", () => {
    const cfg = { ...simpleCfg, allowDraw: false };
    expect(validateResult("simple", { home: 1, away: 1 }, cfg)).toBeTruthy();
    expect(validateResult("simple", { home: 2, away: 1 }, cfg)).toBeNull();
  });
  it("rejects negatives and non-integers", () => {
    expect(validateResult("simple", { home: -1, away: 0 }, simpleCfg)).toBeTruthy();
    expect(validateResult("simple", { home: 1.5, away: 0 }, simpleCfg)).toBeTruthy();
  });
});

describe("sets profile", () => {
  const r = { sets: [[25, 20], [23, 25], [15, 10]] as [number, number][], home: 2, away: 1 };
  it("resolves sets won + display", () => {
    const out = resolve("sets", r);
    expect(out.winner).toBe("home");
    expect(out.display).toBe("2–1 (25–20, 23–25, 15–10)");
    expect(out.homeScore).toBe(2);
  });
  it("never draws → win is 3/0", () => {
    expect(leaguePoints(r, "sets", setsCfg)).toEqual({ home: 3, away: 0 });
  });
  it("rejects an empty set list and tied sets", () => {
    expect(validateResult("sets", { sets: [] }, setsCfg)).toBeTruthy();
    expect(validateResult("sets", { sets: [[25, 25]] }, setsCfg)).toBeTruthy();
    expect(
      validateResult("sets", { sets: [[25, 20], [20, 25]] }, setsCfg),
    ).toBeTruthy(); // 1-1 can't stand
    expect(validateResult("sets", { sets: [[25, 20]] }, setsCfg)).toBeNull();
  });
});

describe("winner profile", () => {
  it("resolves + points", () => {
    expect(resolve("winner", { winner: "away" }).winner).toBe("away");
    expect(leaguePoints({ winner: "home" }, "winner", winnerCfg)).toEqual({
      home: 3,
      away: 0,
    });
  });
  it("requires a winner", () => {
    expect(validateResult("winner", {}, winnerCfg)).toBeTruthy();
    expect(validateResult("winner", { winner: "home" }, winnerCfg)).toBeNull();
  });
});

describe("special results", () => {
  it("validates walkover/DQ require a winner, abandoned forbids one", () => {
    expect(validateResult("simple", { special: "walkover" }, simpleCfg)).toBeTruthy();
    expect(
      validateResult("simple", { special: "walkover", winner: "home" }, simpleCfg),
    ).toBeNull();
    expect(
      validateResult("simple", { special: "disqualification", winner: "away" }, simpleCfg),
    ).toBeNull();
    expect(validateResult("simple", { special: "abandoned" }, simpleCfg)).toBeNull();
    expect(
      validateResult("simple", { special: "abandoned", winner: "home" }, simpleCfg),
    ).toBeTruthy();
    expect(validateResult("simple", { special: "tull" }, simpleCfg)).toBeTruthy();
  });

  it("works regardless of the active profile (sets/winner)", () => {
    expect(
      validateResult("sets", { special: "walkover", winner: "home" }, setsCfg),
    ).toBeNull();
    expect(
      validateResult("winner", { special: "walkover", winner: "away" }, winnerCfg),
    ).toBeNull();
  });

  it("resolves a walkover to the recorded winner with a 1–0 default", () => {
    const out = resolve("simple", { special: "walkover", winner: "home" }, simpleCfg);
    expect(out.winner).toBe("home");
    expect(out.display).toBe("W.O.");
    expect(out.homeScore).toBe(1);
    expect(out.awayScore).toBe(0);
  });

  it("honours a configured walkover scoreline", () => {
    const cfg: ScoringConfig = { ...simpleCfg, walkoverScore: [3, 0] };
    const out = resolve("simple", { special: "walkover", winner: "away" }, cfg);
    expect(out.awayScore).toBe(3);
    expect(out.homeScore).toBe(0);
  });

  it("resolves an abandoned match as a void draw", () => {
    const out = resolve("simple", { special: "abandoned" }, simpleCfg);
    expect(out.winner).toBe("draw");
    expect(out.display).toBe("Avbrutt");
    expect(out.homeScore).toBe(0);
    expect(isVoid({ special: "abandoned" })).toBe(true);
    expect(isVoid({ home: 1, away: 0 })).toBe(false);
  });

  it("awards league points for walkover/DQ but none for abandoned", () => {
    expect(leaguePoints({ special: "walkover", winner: "home" }, "simple", simpleCfg)).toEqual({
      home: 3,
      away: 0,
    });
    expect(
      leaguePoints({ special: "disqualification", winner: "away" }, "simple", simpleCfg),
    ).toEqual({ home: 0, away: 3 });
    expect(leaguePoints({ special: "abandoned" }, "simple", simpleCfg)).toEqual({
      home: 0,
      away: 0,
    });
  });
});

describe("defaultScoringConfig", () => {
  it("sets default best-of-5 + no draw; simple allows draw", () => {
    expect(defaultScoringConfig("sets")).toMatchObject({ setsBestOf: 5, allowDraw: false });
    expect(defaultScoringConfig("simple").allowDraw).toBe(true);
    expect(defaultScoringConfig("winner").allowDraw).toBe(false);
  });
});
