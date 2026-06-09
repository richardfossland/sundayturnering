import { describe, it, expect } from "vitest";
import {
  bracketSize,
  seedOrder,
  buildBracket,
  advanceBracket,
} from "@/lib/tournament/bracket";

function seeds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `s${i + 1}`);
}

describe("seedOrder", () => {
  it("size 4 → [1,4,2,3]", () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
  });
  it("size 8 → standard order, 1 & 2 at opposite ends", () => {
    const o = seedOrder(8);
    expect(o).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(o[0]).toBe(1);
    expect(o.indexOf(2)).toBeGreaterThan(3); // seed 2 in the bottom half
  });
});

describe("bracketSize", () => {
  it.each([
    [2, 2],
    [3, 4],
    [4, 4],
    [5, 8],
    [8, 8],
    [9, 16],
  ])("n=%i → %i", (n, p) => expect(bracketSize(n)).toBe(p));
});

describe("buildBracket", () => {
  it("4 teams → 2+1 matches, no byes, 2 rounds", () => {
    const b = buildBracket(seeds(4));
    expect(b.rounds).toBe(2);
    expect(b.matches.filter((m) => m.round === 1)).toHaveLength(2);
    expect(b.matches.filter((m) => m.round === 2)).toHaveLength(1);
    expect(b.matches.some((m) => m.status === "bye")).toBe(false);
    // seed1 (s1) faces seed4 (s4) in round 1
    const r1 = b.matches.filter((m) => m.round === 1);
    expect(r1[0]).toMatchObject({ homeId: "s1", awayId: "s4" });
    expect(r1[1]).toMatchObject({ homeId: "s2", awayId: "s3" });
  });

  it("5-team cup → byes go to the top seeds, propagated into round 2", () => {
    const b = buildBracket(seeds(5));
    expect(b.rounds).toBe(3); // size 8
    const byes = b.matches.filter((m) => m.status === "bye");
    expect(byes).toHaveLength(3); // seeds 1,2,3 get byes
    for (const bye of byes)
      expect(["s1", "s2", "s3"]).toContain(bye.winnerId);
    // s4 vs s5 is the only real round-1 match
    const real = b.matches.filter(
      (m) => m.round === 1 && m.status === "scheduled",
    );
    expect(real).toHaveLength(1);
    expect([real[0].homeId, real[0].awayId].sort()).toEqual(["s4", "s5"]);
    // s2 and s3 byes meet in a round-2 match (both pre-filled)
    const filledR2 = b.matches.filter(
      (m) => m.round === 2 && m.homeId && m.awayId,
    );
    expect(filledR2).toHaveLength(1);
    expect([filledR2[0].homeId, filledR2[0].awayId].sort()).toEqual([
      "s2",
      "s3",
    ]);
  });

  it("resolves a full 4-team bracket to one champion via advanceBracket", () => {
    let b = buildBracket(seeds(4)); // r1: s1-s4, s2-s3 ; final r2s0
    // s1 beats s4, s2 beats s3
    b = advanceBracket(b, 1, 0, "s1");
    b = advanceBracket(b, 1, 1, "s2");
    const final = b.matches.find((m) => m.round === 2 && m.slot === 0)!;
    expect(final.homeId).toBe("s1");
    expect(final.awayId).toBe("s2");
    // s1 wins the final
    b = advanceBracket(b, 2, 0, "s1");
    // no further round to fill → s1 is champion (final has both sides + a winner)
    expect(final.round).toBe(b.rounds);
  });

  it("8-seed bracket: every winner flows to a distinct next slot", () => {
    const b = buildBracket(seeds(8));
    expect(b.rounds).toBe(3);
    expect(b.matches.filter((m) => m.round === 1)).toHaveLength(4);
    expect(b.links.filter((l) => l.fromRound === 1)).toHaveLength(4);
    const targets = b.links
      .filter((l) => l.fromRound === 1)
      .map((l) => `${l.toSlot}${l.toSide}`);
    expect(new Set(targets).size).toBe(4); // no two winners collide
  });
});
