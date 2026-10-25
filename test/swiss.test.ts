import { describe, expect, it } from "vitest";
import {
  defaultSwissRounds,
  pairSwissRound,
  sanitiseSwissRounds,
  type SwissPlayed,
} from "@/lib/tournament/swiss";

/** Spill `rounds` runder. Utfall deterministisk: laget med lavest tall vinner (seed 1 sterkest),
 * bortsett fra hver tredje kamp der det svakeste vinner (for litt variasjon i stillingen). */
function simulate(n: number, rounds: number) {
  const ids = Array.from({ length: n }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);
  const points = new Map(ids.map((id) => [id, 0]));
  const played: SwissPlayed[] = [];
  const byeCount = new Map(ids.map((id) => [id, 0]));
  const roundsOut: ReturnType<typeof pairSwissRound>[] = [];
  let k = 0;
  for (let r = 0; r < rounds; r++) {
    const ranked = r === 0 ? ids : [...ids].sort((a, b) => points.get(b)! - points.get(a)! || a.localeCompare(b));
    const pairs = pairSwissRound({ ranked, points, pointsWin: 3, played });
    roundsOut.push(pairs);
    for (const p of pairs) {
      played.push({ home: p.homeId, away: p.awayId });
      if (p.awayId === null) {
        points.set(p.homeId, points.get(p.homeId)! + 3);
        byeCount.set(p.homeId, byeCount.get(p.homeId)! + 1);
        continue;
      }
      const strongHome = p.homeId < p.awayId;
      const upset = ++k % 3 === 0;
      const winner = strongHome !== upset ? p.homeId : p.awayId;
      points.set(winner, points.get(winner)! + 3);
    }
  }
  return { ids, roundsOut, played, byeCount };
}

describe("pairSwissRound", () => {
  it("runde 1: øvre halvdel mot nedre, oddetall gir bye til siste seed", () => {
    const even = pairSwissRound({ ranked: ["a", "b", "c", "d"], points: new Map(), pointsWin: 3, played: [] });
    expect(even).toEqual([
      { homeId: "a", awayId: "c" },
      { homeId: "b", awayId: "d" },
    ]);
    const odd = pairSwissRound({ ranked: ["a", "b", "c", "d", "e"], points: new Map(), pointsWin: 3, played: [] });
    expect(odd.at(-1)).toEqual({ homeId: "e", awayId: null });
    expect(odd).toHaveLength(3);
  });

  // Full serie (N−1 runder) er en komplett rundturnering; for 16 lag kan ingen
  // runde-for-runde-parring garantere det siste, så der testes 12 runder.
  for (const [n, rounds] of [[7, 6], [8, 7], [9, 8], [16, 12]]) {
    it(`${n} lag × ${rounds} runder: ingen omkamp, alle parret hver runde`, () => {
      const { ids, roundsOut, played } = simulate(n, rounds);
      const seen = new Set<string>();
      for (const pairs of roundsOut) {
        const inRound = new Set<string>();
        for (const p of pairs) {
          for (const id of [p.homeId, p.awayId]) {
            if (id === null) continue;
            expect(inRound.has(id)).toBe(false); // hvert lag maks én gang per runde
            inRound.add(id);
          }
          if (p.awayId === null) continue;
          const key = [p.homeId, p.awayId].sort().join("|");
          expect(seen.has(key), `omkamp ${key}`).toBe(false);
          seen.add(key);
        }
        expect(inRound.size).toBe(ids.length);
      }
      expect(played.length).toBeGreaterThan(0);
    });
  }

  it("bye-rotasjon: ingen får to byes før alle har hatt én", () => {
    for (const [n, rounds] of [[7, 5], [9, 8]]) {
      const { roundsOut, ids } = simulate(n, rounds);
      const had = new Set<string>();
      for (const pairs of roundsOut) {
        const bye = pairs.find((p) => p.awayId === null)!.homeId;
        // en gjentakelse er bare lov når alle allerede har hatt bye
        if (had.has(bye)) expect(had.size).toBe(ids.length);
        had.add(bye);
      }
    }
  });

  it("score-grupper: lag med lik poengsum møtes når gruppen er partall", () => {
    const { roundsOut } = simulate(8, 1);
    // Etter runde 1 er 4 vunnet / 4 tapt; runde 2 skal bare parre vinnere med vinnere.
    const ids = Array.from({ length: 8 }, (_, i) => `t0${i + 1}`);
    const points = new Map(ids.map((id) => [id, 0]));
    const played: SwissPlayed[] = [];
    for (const p of roundsOut[0]) {
      played.push({ home: p.homeId, away: p.awayId });
      const w = p.homeId < p.awayId! ? p.homeId : p.awayId!;
      points.set(w, 3);
    }
    const ranked = [...ids].sort((a, b) => points.get(b)! - points.get(a)! || a.localeCompare(b));
    const r2 = pairSwissRound({ ranked, points, pointsWin: 3, played });
    for (const p of r2) expect(points.get(p.homeId)).toBe(points.get(p.awayId!));
  });

  it("deterministisk: samme input gir samme parring", () => {
    expect(simulate(9, 5).roundsOut).toEqual(simulate(9, 5).roundsOut);
  });
});

describe("antall runder", () => {
  it("standard er ceil(log2 N)", () => {
    expect([2, 3, 4, 7, 8, 9, 16].map(defaultSwissRounds)).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });
  it("gyldig 1..N−1", () => {
    expect(sanitiseSwissRounds(undefined, 8)).toBe(3);
    expect(sanitiseSwissRounds(7, 8)).toBe(7);
    expect(sanitiseSwissRounds(8, 8)).toBe("invalid");
    expect(sanitiseSwissRounds(0, 8)).toBe("invalid");
    expect(sanitiseSwissRounds(2.5, 8)).toBe("invalid");
    expect(sanitiseSwissRounds("3", 8)).toBe("invalid");
  });
});
