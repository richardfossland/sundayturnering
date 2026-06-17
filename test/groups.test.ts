import { describe, it, expect } from "vitest";
import {
  splitIntoGroups,
  seedKnockoutFromGroups,
} from "@/lib/tournament/groups";
import { buildBracket, advanceBracket } from "@/lib/tournament/bracket";

function seeds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `s${i + 1}`);
}

describe("splitIntoGroups", () => {
  it("splits 8 into two balanced groups with top seeds apart", () => {
    const g = splitIntoGroups(seeds(8), 2);
    expect(g).toHaveLength(2);
    expect(g[0]).toHaveLength(4);
    expect(g[1]).toHaveLength(4);
    // serpentine: seed 1 and seed 2 land in different groups
    expect(g[0][0]).toBe("s1");
    expect(g[1][0]).toBe("s2");
    // every team appears exactly once
    expect(g.flat().sort()).toEqual(seeds(8).sort());
  });

  it("handles a group count that doesn't divide the team count", () => {
    const g = splitIntoGroups(seeds(7), 2);
    const sizes = g.map((x) => x.length).sort();
    expect(sizes).toEqual([3, 4]); // differ by at most one
    expect(g.flat()).toHaveLength(7);
  });

  it("balances 10 across 4 groups", () => {
    const g = splitIntoGroups(seeds(10), 4);
    expect(g).toHaveLength(4);
    const sizes = g.map((x) => x.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(g.flat()).toHaveLength(10);
    // top 4 seeds spread one-per-group
    expect(g.map((x) => x[0])).toEqual(["s1", "s2", "s3", "s4"]);
  });
});

describe("seedKnockoutFromGroups", () => {
  it("orders winners first, then runners-up (2 groups)", () => {
    expect(
      seedKnockoutFromGroups([
        ["A1", "A2"],
        ["B1", "B2"],
      ]),
    ).toEqual(["A1", "B1", "A2", "B2"]);
  });

  it("keeps same-group qualifiers out of the first knockout round", () => {
    // 2 groups, 2 advance → 4-team bracket. Same-group teams must not meet R1.
    const seedList = seedKnockoutFromGroups([
      ["A1", "A2"],
      ["B1", "B2"],
    ]);
    const b = buildBracket(seedList);
    const r1 = b.matches.filter((m) => m.round === 1);
    for (const m of r1) {
      const pair = [m.homeId, m.awayId];
      // no round-1 match pairs A1&A2 or B1&B2
      expect(pair.includes("A1") && pair.includes("A2")).toBe(false);
      expect(pair.includes("B1") && pair.includes("B2")).toBe(false);
    }
  });

  it("resolves group qualifiers to a single champion", () => {
    const seedList = seedKnockoutFromGroups([
      ["A1", "A2"],
      ["B1", "B2"],
    ]);
    let b = buildBracket(seedList);
    const r1 = b.matches.filter((m) => m.round === 1);
    b = advanceBracket(b, 1, r1[0].slot, r1[0].homeId!);
    b = advanceBracket(b, 1, r1[1].slot, r1[1].homeId!);
    const final = b.matches.find((m) => m.round === b.rounds && m.slot === 0)!;
    expect(final.homeId).toBeTruthy();
    expect(final.awayId).toBeTruthy();
  });
});
