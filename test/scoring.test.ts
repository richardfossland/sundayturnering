import { describe, it, expect } from "vitest";
import {
  resolve,
  leaguePoints,
  validateResult,
  defaultScoringConfig,
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

describe("defaultScoringConfig", () => {
  it("sets default best-of-5 + no draw; simple allows draw", () => {
    expect(defaultScoringConfig("sets")).toMatchObject({ setsBestOf: 5, allowDraw: false });
    expect(defaultScoringConfig("simple").allowDraw).toBe(true);
    expect(defaultScoringConfig("winner").allowDraw).toBe(false);
  });
});
