import { describe, it, expect } from "vitest";
import { estimateEnd, type EstimateInput } from "@/lib/tournament/estimate";
import { roundRobinMatchCount } from "@/lib/tournament/roundRobin";
import type { ScheduleConfig } from "@/lib/types";

const T0 = Date.parse("2026-10-25T09:00:00.000Z");
const MIN = 60_000;

const sched = (over: Partial<ScheduleConfig> = {}): ScheduleConfig => ({
  startAt: new Date(T0).toISOString(),
  matchMinutes: 15,
  breakMinutes: 0,
  minRestMinutes: 0,
  ...over,
});
const minutes = (iso: string | null) => (iso ? (Date.parse(iso) - T0) / MIN : null);

function est(over: Partial<EstimateInput> & Pick<EstimateInput, "format" | "teamCount">) {
  return estimateEnd({ courtCount: 0, schedule: sched(), ...over });
}

describe("estimateEnd", () => {
  it("two teams, one match: ends one match length after the start", () => {
    const r = est({ format: "league", teamCount: 2 });
    expect(r.matchCount).toBe(1);
    expect(minutes(r.endsAt)).toBe(15);
  });

  it("league, one timeline: every match gets its own slot (match + break)", () => {
    const r = est({ format: "league", teamCount: 4, schedule: sched({ breakMinutes: 5 }) });
    expect(r.matchCount).toBe(roundRobinMatchCount(4));
    // 6 matches back to back in 20 min slots; the last one starts at 100 and ends at 115.
    expect(minutes(r.endsAt)).toBe(5 * 20 + 15);
  });

  it("more courts finish earlier", () => {
    const one = est({ format: "league", teamCount: 8, courtCount: 1 });
    const four = est({ format: "league", teamCount: 8, courtCount: 4 });
    expect(four.matchCount).toBe(one.matchCount);
    expect(minutes(four.endsAt)!).toBeLessThan(minutes(one.endsAt)!);
  });

  it("minimum rest can stretch the end", () => {
    const loose = est({ format: "league", teamCount: 4, courtCount: 2 });
    const strict = est({ format: "league", teamCount: 4, courtCount: 2, schedule: sched({ minRestMinutes: 60 }) });
    expect(minutes(strict.endsAt)!).toBeGreaterThan(minutes(loose.endsAt)!);
  });

  it("cup of 4 on two courts: two semifinals at once, then the final", () => {
    const r = est({ format: "cup", teamCount: 4, courtCount: 2 });
    expect(r.matchCount).toBe(3);
    expect(minutes(r.endsAt)).toBe(30);
  });

  it("cup of 4 on one court: three matches in a row", () => {
    const r = est({ format: "cup", teamCount: 4, courtCount: 1 });
    expect(minutes(r.endsAt)).toBe(45);
  });

  it("the bronze final shares the final's slot on two courts", () => {
    const r = est({ format: "cup", teamCount: 4, courtCount: 2, thirdPlace: true });
    expect(r.matchCount).toBe(4);
    expect(minutes(r.endsAt)).toBe(30);
  });

  it("league + playoff starts the knockout after the series", () => {
    const league = est({ format: "league", teamCount: 4, courtCount: 2 });
    const both = est({ format: "league_playoff", teamCount: 4, courtCount: 2, playoffSize: 4 });
    expect(both.matchCount).toBe(league.matchCount + 3);
    // series (3 rounds on two courts) = 45 min, then semis + final = 30 min.
    expect(minutes(both.endsAt)).toBe(minutes(league.endsAt)! + 30);
  });

  it("group play counts every group's matches plus the knockout", () => {
    const r = est({
      format: "group_playoff",
      teamCount: 8,
      courtCount: 2,
      groupCount: 2,
      advancePerGroup: 2,
    });
    // 2 groups of 4 = 12 matches, then a 4-team knockout = 3 matches.
    expect(r.matchCount).toBe(12 + 3);
  });

  it("double elimination plays more matches than a cup of the same size", () => {
    const cup = est({ format: "cup", teamCount: 8, courtCount: 2 });
    const dbl = est({ format: "double_elim", teamCount: 8, courtCount: 2, grandFinalReset: true });
    expect(dbl.matchCount).toBeGreaterThan(cup.matchCount);
    expect(minutes(dbl.endsAt)!).toBeGreaterThan(minutes(cup.endsAt)!);
  });

  it("swiss: rounds follow each other", () => {
    const r = est({ format: "swiss", teamCount: 8, courtCount: 4, swissRounds: 3 });
    expect(r.matchCount).toBe(12);
    // four matches per round fit the four courts: three rounds of 15 minutes.
    expect(minutes(r.endsAt)).toBe(45);
  });

  it("an invalid start or too few teams gives no estimate", () => {
    expect(est({ format: "league", teamCount: 1 }).endsAt).toBeNull();
    expect(est({ format: "league", teamCount: 4, schedule: sched({ startAt: "nope" }) }).endsAt).toBeNull();
  });
});
