import { describe, it, expect } from "vitest";
import { seedKnockoutFromGroups, type GroupRecord } from "@/lib/tournament/groups";
import { buildBracket, bracketSize, seedOrder } from "@/lib/tournament/bracket";

// B1 + B6: sluttspillet seedes etter rekord, og lag fra samme gruppe holdes fra hverandre.

const groupOf = (id: string) => id.split("r")[0]; // "g2r1" → "g2"

function quals(groups: number, advance: number): string[][] {
  return Array.from({ length: groups }, (_, g) =>
    Array.from({ length: advance }, (_, r) => `g${g}r${r}`),
  );
}

/** Antall gruppekamerat-par som møtes i første runde. */
function round1Clashes(seeds: string[]): number {
  return buildBracket(seeds).matches.filter(
    (m) => m.round === 1 && m.homeId && m.awayId && groupOf(m.homeId) === groupOf(m.awayId),
  ).length;
}

/** Antall gruppekamerat-par som ikke ligger i hver sin halvdel av braketten. */
function sameHalfPairs(seeds: string[]): number {
  const size = bracketSize(seeds.length);
  const half = new Map<string, number>();
  seedOrder(size).forEach((seed, i) => {
    if (seed <= seeds.length) half.set(seeds[seed - 1], i < size / 2 ? 0 : 1);
  });
  let c = 0;
  for (let a = 0; a < seeds.length; a++)
    for (let b = a + 1; b < seeds.length; b++)
      if (groupOf(seeds[a]) === groupOf(seeds[b]) && half.get(seeds[a]) === half.get(seeds[b])) c++;
  return c;
}

/** Alle omstokkinger av nivå 2..a med nivå 1 fast (samme grunnlag som seedingen har). */
function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield items;
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i], ...p];
  }
}
function* arrangements(q: string[][], tier: number): Generator<string[]> {
  if (tier >= (q[0]?.length ?? 0)) {
    yield [];
    return;
  }
  const ids = q.map((g) => g[tier]);
  for (const p of permutations(ids)) for (const rest of arrangements(q, tier + 1)) yield [...p, ...rest];
}
const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

/** Minste antall konflikter noen omstokking av nivåene kan gi (uttømmende). */
function bestPossible(q: string[][], measure: (s: string[]) => number): number {
  const winners = q.map((g) => g[0]);
  let best = Infinity;
  for (const rest of arrangements(q, 1)) {
    best = Math.min(best, measure([...winners, ...rest]));
    if (best === 0) break;
  }
  return best;
}

describe("seedKnockoutFromGroups — rekord (B6)", () => {
  const rec = (played: number, points: number, diff: number, scored: number): GroupRecord => ({
    played, points, diff, scored,
  });

  it("orders each tier by points per game, not by group letter", () => {
    const q = [["A1", "A2"], ["B1", "B2"], ["C1", "C2"]];
    const records = new Map<string, GroupRecord>([
      ["A1", rec(2, 3, 0, 2)], ["B1", rec(2, 6, 4, 6)], ["C1", rec(2, 4, 1, 3)],
      ["A2", rec(2, 0, -2, 1)], ["B2", rec(2, 1, -1, 1)], ["C2", rec(2, 1, -1, 1)],
    ]);
    const seeds = seedKnockoutFromGroups(q, records);
    expect(seeds.slice(0, 3)).toEqual(["B1", "C1", "A1"]);
  });

  it("compares per game so a bigger group's total doesn't win by itself", () => {
    // A (4 lag, 3 kamper): 6 poeng = 2/kamp. B (3 lag, 2 kamper): 6 poeng = 3/kamp.
    const q = [["A1"], ["B1"]];
    const records = new Map<string, GroupRecord>([
      ["A1", rec(3, 6, 3, 6)],
      ["B1", rec(2, 6, 3, 6)],
    ]);
    expect(seedKnockoutFromGroups(q, records)).toEqual(["B1", "A1"]);
  });

  it("falls back to goal difference per game, then goals scored per game, then group order", () => {
    const q = [["A1"], ["B1"], ["C1"], ["D1"]];
    const records = new Map<string, GroupRecord>([
      ["A1", rec(2, 4, 2, 3)],
      ["B1", rec(2, 4, 4, 4)], // bedre diff
      ["C1", rec(2, 4, 2, 5)], // lik diff som A, flere scoret
      ["D1", rec(2, 4, 2, 5)], // helt lik C → gruppe-rekkefølge
    ]);
    expect(seedKnockoutFromGroups(q, records)).toEqual(["B1", "C1", "D1", "A1"]);
  });

  it("without records the group order stays (old behaviour)", () => {
    expect(seedKnockoutFromGroups([["A1", "A2"], ["B1", "B2"]])).toEqual(["A1", "B1", "A2", "B2"]);
  });
});

describe("seedKnockoutFromGroups — gruppekamerater (B1)", () => {
  it("3 groups × 2 videre: ingen gruppekamerater i første runde (var C1–C2)", () => {
    const q = quals(3, 2);
    // Gammel rekkefølge: g0r0 g1r0 g2r0 g0r1 g1r1 g2r1 → seed 3 (g2r0) mot seed 6 (g2r1).
    const old = [0, 1].flatMap((r) => q.map((g) => g[r]));
    expect(round1Clashes(old)).toBe(1);
    expect(round1Clashes(seedKnockoutFromGroups(q))).toBe(0);
  });

  it("4 groups × 2 videre: vinner og toer i hver sin halvdel (var samme halvdel)", () => {
    const q = quals(4, 2);
    const old = [0, 1].flatMap((r) => q.map((g) => g[r]));
    expect(sameHalfPairs(old)).toBeGreaterThan(0);
    const seeds = seedKnockoutFromGroups(q);
    expect(sameHalfPairs(seeds)).toBe(0);
    expect(round1Clashes(seeds)).toBe(0);
  });

  it("winners keep their record order and every qualifier appears exactly once", () => {
    const q = quals(5, 3);
    const seeds = seedKnockoutFromGroups(q);
    expect(seeds.slice(0, 5)).toEqual(q.map((g) => g[0]));
    expect([...seeds].sort()).toEqual(q.flat().sort());
  });

  it("brute force: groups 2–8 × advance 1–4 — no round-1 clash whenever avoidable", () => {
    let cases = 0;
    for (let groups = 2; groups <= 8; groups++) {
      for (let advance = 1; advance <= 4; advance++) {
        const q = quals(groups, advance);
        const seeds = seedKnockoutFromGroups(q);
        expect(seeds).toHaveLength(groups * advance);
        const got = round1Clashes(seeds);
        // Uttømmende sammenligning der søkerommet er overkommelig; ellers kreves null.
        const space = factorial(groups) ** (advance - 1);
        const best = space <= 600_000 ? bestPossible(q, round1Clashes) : 0;
        expect(got, `groups=${groups} advance=${advance}`).toBe(best);
        cases++;
      }
    }
    expect(cases).toBe(28);
  });

  it("brute force: groups 2–8, advance 2 — winner and runner-up in opposite halves whenever avoidable", () => {
    for (let groups = 2; groups <= 8; groups++) {
      const q = quals(groups, 2);
      const seeds = seedKnockoutFromGroups(q);
      expect(sameHalfPairs(seeds), `groups=${groups}`).toBe(bestPossible(q, sameHalfPairs));
      expect(round1Clashes(seeds), `groups=${groups}`).toBe(0);
    }
  });

  it("uneven groups (some with fewer qualifiers) still avoid round-1 clashes", () => {
    for (const q of [
      [["g0r0", "g0r1", "g0r2"], ["g1r0", "g1r1"], ["g2r0", "g2r1"]],
      [["g0r0", "g0r1"], ["g1r0"], ["g2r0", "g2r1"], ["g3r0", "g3r1"]],
    ]) {
      const seeds = seedKnockoutFromGroups(q);
      expect([...seeds].sort()).toEqual(q.flat().sort());
      expect(round1Clashes(seeds)).toBe(0);
    }
  });

  it("many groups (search budget) still returns a valid permutation", () => {
    const q = quals(12, 3);
    const seeds = seedKnockoutFromGroups(q);
    expect([...seeds].sort()).toEqual(q.flat().sort());
  });

  it("B-sluttspill: de som falt ut krysseedes på samme måte", async () => {
    const { bSeedsFromGroups } = await import("@/lib/tournament/consolation");
    // 3 grupper à 4, 2 videre → B = nr. 3 og 4 i hver gruppe.
    const ranked = Array.from({ length: 3 }, (_, g) => [0, 1, 2, 3].map((r) => `g${g}r${r}`));
    const b = bSeedsFromGroups(ranked, 2);
    expect(b).toHaveLength(6);
    expect(round1Clashes(b)).toBe(0);
  });
});
