import { describe, expect, it } from "vitest";
import {
  buildDoubleElim,
  grandFinalAction,
  DOUBLE_ELIM_MIN_TEAMS,
} from "@/lib/tournament/doubleElim";
import type { BracketSet } from "@/lib/tournament/consolation";

// Ren simulering av bracket_links-propagering (samme regler som RPC-en
// `propagate_playoff_result`, inkl. omkampen) over en bygd dobbel utslag.

interface SimMatch {
  key: string;
  bracket: string;
  round: number;
  home: string | null;
  away: string | null;
  status: "scheduled" | "done" | "bye";
  winner: string | null;
}
interface SimLink { from: string; to: string; side: "home" | "away"; feed: "winner" | "loser" }

const k = (b: string, r: number, s: number) => `${b}:${r}:${s}`;

function toSim(set: BracketSet) {
  const matches = new Map<string, SimMatch>();
  const links: SimLink[] = [];
  for (const { id, bracket } of set.brackets) {
    for (const m of bracket.matches)
      matches.set(k(id, m.round, m.slot), {
        key: k(id, m.round, m.slot), bracket: id, round: m.round,
        home: m.homeId, away: m.awayId, status: m.status === "bye" ? "bye" : "scheduled",
        winner: m.winnerId,
      });
    for (const l of bracket.links)
      links.push({ from: k(id, l.fromRound, l.fromSlot), to: k(id, l.toRound, l.toSlot), side: l.toSide, feed: l.feed });
  }
  for (const c of set.cross)
    links.push({
      from: k(c.fromBracket, c.fromRound, c.fromSlot),
      to: k(c.toBracket, c.toRound, c.toSlot),
      side: c.toSide,
      feed: c.feed,
    });
  return { matches, links };
}

/** Deterministisk PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const teamsOf = (n: number) => Array.from({ length: n }, (_, i) => `T${i + 1}`);

function propagate(sim: ReturnType<typeof toSim>, m: SimMatch) {
  const loser = m.winner === m.home ? m.away : m.home;
  for (const l of sim.links.filter((x) => x.from === m.key)) {
    const t = sim.matches.get(l.to)!;
    const id = l.feed === "winner" ? m.winner : loser;
    if (l.side === "home") t.home = id;
    else t.away = id;
  }
  if (m.bracket === "GF" && m.round === 1) {
    const gf2 = sim.matches.get(k("GF", 2, 0));
    if (gf2) {
      const act = grandFinalAction({ home_team_id: m.home, winner_team_id: m.winner }, true);
      if (act === "void") { gf2.status = "bye"; gf2.winner = m.winner; }
    }
  }
}

/** Spill hele turneringen; `pick` velger vinner (true = hjemme). */
function play(set: BracketSet, pick: (m: SimMatch) => boolean) {
  const sim = toSim(set);
  const losses = new Map<string, number>();
  let played = 0;
  for (;;) {
    const next = [...sim.matches.values()].find(
      (m) => m.status === "scheduled" && m.home && m.away,
    );
    if (!next) break;
    for (const t of [next.home!, next.away!])
      expect(losses.get(t) ?? 0, `${t} spilte etter to tap i ${next.key}`).toBeLessThan(2);
    next.winner = pick(next) ? next.home : next.away;
    next.status = "done";
    const lose = next.winner === next.home ? next.away! : next.home!;
    losses.set(lose, (losses.get(lose) ?? 0) + 1);
    played++;
    propagate(sim, next);
  }
  return { sim, losses, played };
}

describe("buildDoubleElim struktur", () => {
  it("avviser færre enn 3 lag", () => {
    expect(() => buildDoubleElim(teamsOf(DOUBLE_ELIM_MIN_TEAMS - 1))).toThrow();
  });

  it.each([
    [4, 6], // 3 W + 2 L + GF (+ omkamp)
    [8, 14],
    [16, 30],
  ])("%i lag: %i spilte kamper uten omkamp-tillegg (2N−2)", (n, expected) => {
    const set = buildDoubleElim(teamsOf(n), { grandFinalReset: true });
    const real = set.brackets
      .flatMap((b) => b.bracket.matches)
      .filter((m) => m.status !== "bye");
    // 2N−2 pluss omkampen (som bare spilles når L vinner storfinalen).
    expect(real).toHaveLength(expected + 1);
    const noReset = buildDoubleElim(teamsOf(n), { grandFinalReset: false });
    expect(
      noReset.brackets.flatMap((b) => b.bracket.matches).filter((m) => m.status !== "bye"),
    ).toHaveLength(expected);
  });

  it("5 og 6 lag: frirunder gir ingen ekstra L-kamper (2N−2 spilles)", () => {
    for (const n of [5, 6]) {
      const set = buildDoubleElim(teamsOf(n), { grandFinalReset: false });
      const real = set.brackets.flatMap((b) => b.bracket.matches).filter((m) => m.status !== "bye");
      expect(real).toHaveLength(2 * n - 2);
    }
  });

  it("brakettene kommer som W, L, GF", () => {
    expect(buildDoubleElim(teamsOf(8)).brackets.map((b) => b.id)).toEqual(["W", "L", "GF"]);
  });

  it("8 lag: første inndroppsrunde snus (L2 kamp 0 får taperen av W2 kamp 1)", () => {
    const set = buildDoubleElim(teamsOf(8));
    const fromW2 = set.cross.filter((c) => c.toBracket === "L" && c.toRound === 2 && c.fromRound === 2);
    expect(fromW2.find((c) => c.toSlot === 0)!.fromSlot).toBe(1);
    expect(fromW2.find((c) => c.toSlot === 1)!.fromSlot).toBe(0);
  });

  it("omkampen mates av storfinalen (vinner hjemme, taper borte)", () => {
    const set = buildDoubleElim(teamsOf(4));
    const gf = set.brackets.find((b) => b.id === "GF")!.bracket;
    expect(gf.matches).toHaveLength(2);
    expect(gf.links.map((l) => `${l.toSide}:${l.feed}`).sort()).toEqual(["away:loser", "home:winner"]);
    expect(buildDoubleElim(teamsOf(4), { grandFinalReset: false }).brackets[2].bracket.matches).toHaveLength(1);
  });

  it("frirunde-vinner kommer rett inn i W2, og ingen L-kamp venter på en tapt frirunde", () => {
    const set = buildDoubleElim(teamsOf(6));
    const w = set.brackets[0].bracket;
    expect(w.matches.filter((m) => m.round === 1 && m.status === "bye")).toHaveLength(2);
    // Hver L-kamp har to mater (kilder), ingen har bare én.
    const l = set.brackets[1].bracket;
    for (const m of l.matches) {
      const feeders =
        l.links.filter((x) => x.toRound === m.round && x.toSlot === m.slot).length +
        set.cross.filter((c) => c.toBracket === "L" && c.toRound === m.round && c.toSlot === m.slot).length;
      expect(feeders).toBe(2);
    }
  });
});

describe("fullt spilt dobbel utslag (tilfeldige vinnere)", () => {
  const ns = [3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 16, 17, 24, 31, 32];
  for (const reset of [true, false]) {
    it(`alle lag er ute etter to tap (omkamp ${reset})`, () => {
      for (const n of ns) {
        for (let seed = 1; seed <= 12; seed++) {
          const r = rng(seed * 1000 + n);
          const set = buildDoubleElim(teamsOf(n), { grandFinalReset: reset });
          const { sim, losses, played } = play(set, () => r() < 0.5);

          // Alle kamper avgjort (omkampen kan være utgått).
          for (const m of sim.matches.values()) expect(["done", "bye"]).toContain(m.status);

          const gf1 = sim.matches.get(k("GF", 1, 0))!;
          const gf2 = sim.matches.get(k("GF", 2, 0));
          const champ = gf2 && gf2.status === "done" ? gf2.winner! : gf1.winner!;
          const rematchPlayed = !!gf2 && gf2.status === "done";

          // Mester: 0 tap, eller 1 tap (kom fra L og vant storfinalen).
          expect(losses.get(champ) ?? 0).toBe(gf1.winner === gf1.home ? 0 : 1);
          // Alle andre: nøyaktig to tap. Uten omkamp er W-laget som taper storfinalen
          // ute etter ÉN tap (storfinalen avgjør alt).
          const runnerUp = champ === gf1.home ? gf1.away : gf1.home;
          for (const t of teamsOf(n)) {
            if (t === champ) continue;
            const expected = !reset && t === runnerUp && gf1.winner !== gf1.home ? 1 : 2;
            expect(losses.get(t), `${t} (n=${n}, seed=${seed})`).toBe(expected);
          }
          expect(played).toBe(2 * n - 2 + (rematchPlayed ? 1 : 0));
        }
      }
    });
  }

  it("W-vinneren vinner storfinalen: omkampen utgår", () => {
    const set = buildDoubleElim(teamsOf(8));
    const { sim, played } = play(set, (m) => (m.bracket === "GF" ? true : m.home! < m.away!));
    expect(sim.matches.get(k("GF", 2, 0))!.status).toBe("bye");
    expect(played).toBe(2 * 8 - 2);
  });

  it("L-vinneren vinner storfinalen: omkampen spilles", () => {
    const set = buildDoubleElim(teamsOf(8));
    const { sim, played } = play(set, (m) => (m.bracket === "GF" && m.round === 1 ? false : true));
    const gf2 = sim.matches.get(k("GF", 2, 0))!;
    expect(gf2.status).toBe("done");
    expect(played).toBe(2 * 8 - 1);
    // Omkampen har samme to lag som storfinalen.
    const gf1 = sim.matches.get(k("GF", 1, 0))!;
    expect([gf2.home, gf2.away].sort()).toEqual([gf1.home, gf1.away].sort());
  });

  it("uten omkamp avgjør storfinalen alt", () => {
    const set = buildDoubleElim(teamsOf(8), { grandFinalReset: false });
    const { sim, played } = play(set, () => false);
    expect(sim.matches.has(k("GF", 2, 0))).toBe(false);
    expect(played).toBe(2 * 8 - 2); // L-vinneren vant, og det er nok
  });
});

describe("grandFinalAction", () => {
  it("void når hjemmelaget (W) vinner, restore når borte vinner", () => {
    expect(grandFinalAction({ home_team_id: "a", winner_team_id: "a" }, true)).toBe("void");
    expect(grandFinalAction({ home_team_id: "a", winner_team_id: "b" }, true)).toBe("restore");
    expect(grandFinalAction({ home_team_id: "a", winner_team_id: "a" }, false)).toBeNull();
    expect(grandFinalAction({ home_team_id: "a", winner_team_id: null }, true)).toBeNull();
  });
});
