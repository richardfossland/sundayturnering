import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScheduleConfig } from "@/lib/types";

// Wiring: buildCupMatches skriver A og B i ÉN omgang — B-rader får bracket='B',
// koblingene (også tapere fra A til B) peker på riktige rader, og tidsplanen
// legger B på de samme banene som A.

type Row = Record<string, unknown>;
let matches: Row[] = [];
let links: Row[] = [];

vi.mock("@/lib/server/store", () => ({
  db: () => ({
    from: (table: string) => ({
      insert: async (rows: Row[] | Row) => {
        if (table === "matches") matches = rows as Row[];
        if (table === "bracket_links") links = rows as Row[];
        return { error: null };
      },
    }),
  }),
  getMatches: async () =>
    matches.map((r, i) => ({
      id: `id${i}`,
      phase: "playoff",
      round: r.round,
      bracket_slot: r.bracket_slot,
      bracket: r.bracket ?? "A",
    })),
}));

import { buildCupMatches } from "@/lib/server/build";

const schedule: ScheduleConfig = {
  startAt: "2026-10-25T09:00:00.000Z",
  matchMinutes: 10,
  breakMinutes: 0,
  minRestMinutes: 0,
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
const idOfRow = (r: Row) => `id${matches.indexOf(r)}`;

beforeEach(() => {
  matches = [];
  links = [];
});

describe("buildCupMatches med B-sluttspill (bSeeds)", () => {
  it("A uendret uten bracket-kolonne; B-rader har bracket='B' og egne lag", async () => {
    await buildCupMatches("t", ids(4), [], { bSeeds: ["b1", "b2", "b3", "b4", "b5", "b6"] });
    const a = matches.filter((r) => r.bracket === undefined);
    const b = matches.filter((r) => r.bracket === "B");
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(7); // 6 lag: 2 byer + 4 ekte i 8-brakett → 4+2+1 = 7 rader
    expect(b.filter((r) => r.status === "bye")).toHaveLength(2);
    // Hver kobling ligger innenfor sin egen brakett.
    const bIds = new Set(b.map(idOfRow));
    const bLinks = links.filter((l) => bIds.has(l.from_match_id as string));
    expect(bLinks.every((l) => bIds.has(l.to_match_id as string))).toBe(true);
    expect(bLinks).toHaveLength(6);
  });

  it("uten bSeeds er resultatet identisk med før (ingen B)", async () => {
    await buildCupMatches("t", ids(4), []);
    expect(matches).toHaveLength(3);
    expect(matches.some((r) => "bracket" in r)).toBe(false);
  });

  it("kø: runde for runde, A før B", async () => {
    await buildCupMatches("t", ids(4), [], { bSeeds: ["b1", "b2", "b3", "b4"] });
    const order = [...matches].sort((x, y) => (x.queue_order as number) - (y.queue_order as number));
    const key = order.map((r) => `${r.bracket ?? "A"}${r.round}`);
    expect(key).toEqual(["A1", "A1", "B1", "B1", "A2", "B2"]);
  });
});

describe("buildCupMatches med trøsterunde (cup)", () => {
  it("8 lag: B-rader har ingen lag ved start, og taper-koblinger går A-R1 → B", async () => {
    await buildCupMatches("t", ids(8), [], { consolation: "first_round_losers" });
    const b = matches.filter((r) => r.bracket === "B");
    expect(b).toHaveLength(3);
    expect(b.every((r) => r.home_team_id === null && r.away_team_id === null)).toBe(true);
    const loser = links.filter((l) => l.feed === "loser");
    expect(loser).toHaveLength(4);
    const bIds = new Set(b.map(idOfRow));
    expect(loser.every((l) => bIds.has(l.to_match_id as string))).toBe(true);
    const aR1 = new Set(matches.filter((r) => r.bracket === undefined && r.round === 1).map(idOfRow));
    expect(loser.every((l) => aR1.has(l.from_match_id as string))).toBe(true);
  });

  it("6 lag: bare to tapere → én B-kamp", async () => {
    await buildCupMatches("t", ids(6), [], { consolation: "first_round_losers" });
    expect(matches.filter((r) => r.bracket === "B")).toHaveLength(1);
    expect(links.filter((l) => l.feed === "loser")).toHaveLength(2);
  });

  it("ikke mulig (5 lag) → bygges som vanlig cup", async () => {
    await buildCupMatches("t", ids(5), [], { consolation: "first_round_losers" });
    expect(matches.some((r) => r.bracket === "B")).toBe(false);
  });

  it("tidsplan: B får klokkeslett og deler baner med A, og kommer etter A-kampen som mater den", async () => {
    await buildCupMatches("t", ids(8), ["c1", "c2"], { consolation: "first_round_losers", schedule });
    const b = matches.filter((r) => r.bracket === "B");
    expect(b.every((r) => typeof r.scheduled_at === "string")).toBe(true);
    const end = (r: Row) => Date.parse(r.scheduled_at as string) + 10 * 60_000;
    const lastAR1 = Math.max(...matches.filter((r) => !r.bracket && r.round === 1).map(end));
    const b1 = b.filter((r) => r.round === 1);
    for (const r of b1) expect(Date.parse(r.scheduled_at as string)).toBeGreaterThanOrEqual(lastAR1 - 10 * 60_000);
    // Baner delt: ingen to kamper på samme bane overlapper.
    const byCourt = new Map<string, number[]>();
    for (const r of matches.filter((x) => x.court_id)) {
      const arr = byCourt.get(r.court_id as string) ?? [];
      arr.push(Date.parse(r.scheduled_at as string));
      byCourt.set(r.court_id as string, arr);
    }
    for (const times of byCourt.values()) expect(new Set(times).size).toBe(times.length);
  });
});
