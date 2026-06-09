import { describe, it, expect } from "vitest";
import {
  generateRoundRobin,
  roundRobinMatchCount,
  roundRobinRoundCount,
} from "@/lib/tournament/roundRobin";

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${i + 1}`);
}

/** Every unordered pair appears exactly `times`. */
function pairCounts(pairs: { homeId: string; awayId: string | null }[]) {
  const m = new Map<string, number>();
  for (const p of pairs) {
    if (p.awayId === null) continue;
    const key = [p.homeId, p.awayId].sort().join("|");
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

describe("generateRoundRobin", () => {
  it("8 teams → 28 matches, 7 rounds, every pair once", () => {
    const ps = generateRoundRobin(ids(8));
    expect(ps.filter((p) => p.awayId !== null)).toHaveLength(28);
    expect(roundRobinMatchCount(8)).toBe(28);
    expect(roundRobinRoundCount(8)).toBe(7);
    expect(new Set(ps.map((p) => p.round)).size).toBe(7);
    const counts = pairCounts(ps);
    expect(counts.size).toBe(28);
    for (const c of counts.values()) expect(c).toBe(1);
  });

  it("no team plays twice in the same round (8 teams)", () => {
    const ps = generateRoundRobin(ids(8));
    const byRound = new Map<number, string[]>();
    for (const p of ps) {
      const arr = byRound.get(p.round) ?? [];
      arr.push(p.homeId);
      if (p.awayId) arr.push(p.awayId);
      byRound.set(p.round, arr);
    }
    for (const arr of byRound.values())
      expect(new Set(arr).size).toBe(arr.length);
  });

  it("6 teams → 15 matches, no byes (even)", () => {
    const ps = generateRoundRobin(ids(6));
    expect(ps.filter((p) => p.awayId !== null)).toHaveLength(15);
    expect(ps.filter((p) => p.awayId === null)).toHaveLength(0);
  });

  it("5 teams → 10 matches + one bye per round, each team byes once", () => {
    const ps = generateRoundRobin(ids(5));
    expect(ps.filter((p) => p.awayId !== null)).toHaveLength(10);
    const byes = ps.filter((p) => p.awayId === null);
    expect(byes).toHaveLength(5); // 5 rounds, one bye each
    // exactly one bye per round
    const byRound = new Map<number, number>();
    for (const b of byes) byRound.set(b.round, (byRound.get(b.round) ?? 0) + 1);
    for (const c of byRound.values()) expect(c).toBe(1);
    // each team byes exactly once → fair distribution
    expect(new Set(byes.map((b) => b.homeId)).size).toBe(5);
  });

  it("double round-robin → every pair twice, double the rounds", () => {
    const ps = generateRoundRobin(ids(4), { double: true });
    expect(ps).toHaveLength(12); // 6 pairs × 2
    const counts = pairCounts(ps);
    for (const c of counts.values()) expect(c).toBe(2);
    expect(new Set(ps.map((p) => p.round)).size).toBe(6);
  });

  it("parallel mode: when courts ≥ matches/round, no court is reused in a round", () => {
    // 8 teams → 4 matches/round; 4 courts → each court used once per round.
    const ps = generateRoundRobin(ids(8), { courtCount: 4 });
    const byRound = new Map<number, Set<number>>();
    for (const p of ps) {
      if (p.courtIndex === null) continue;
      const set = byRound.get(p.round) ?? new Set<number>();
      expect(set.has(p.courtIndex)).toBe(false);
      set.add(p.courtIndex);
      byRound.set(p.round, set);
    }
  });

  it("parallel mode: court indices stay within range when matches > courts", () => {
    // 8 teams → 4 matches/round, only 3 courts → a court hosts 2 (sequenced by
    // queueOrder); indices must still be valid.
    const ps = generateRoundRobin(ids(8), { courtCount: 3 });
    for (const p of ps) {
      if (p.courtIndex === null) continue;
      expect(p.courtIndex).toBeGreaterThanOrEqual(0);
      expect(p.courtIndex).toBeLessThan(3);
    }
  });

  it("queueOrder is a dense 0..k-1 sequence", () => {
    const ps = generateRoundRobin(ids(6));
    const orders = ps.map((p) => p.queueOrder).sort((a, b) => a - b);
    expect(orders).toEqual(orders.map((_, i) => i));
  });
});
