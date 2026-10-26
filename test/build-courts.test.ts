import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScheduleConfig } from "@/lib/types";

// Baner for brakettkamper: tidsplanen velger (tidligste ledige), og uten
// tidsplan fordeles kampene jevnt innen hver runde (ikke `slot % baner`).

type Row = Record<string, unknown>;
let inserted: Row[] = [];

vi.mock("@/lib/server/store", () => ({
  db: () => ({
    from: () => ({
      insert: async (rows: Row[] | Row) => {
        if (Array.isArray(rows) && rows[0] && "round" in rows[0]) inserted = rows;
        return { error: null };
      },
    }),
  }),
  getMatches: async () =>
    inserted.map((r, i) => ({
      id: `id${i}`,
      phase: "playoff",
      bracket: r.bracket ?? "A",
      round: r.round,
      bracket_slot: r.bracket_slot,
    })),
}));

import { buildCupMatches, buildDoubleElimMatches } from "@/lib/server/build";

const courts = ["c1", "c2"];
const schedule: ScheduleConfig = {
  startAt: "2026-10-25T09:00:00.000Z",
  matchMinutes: 10,
  breakMinutes: 5,
  minRestMinutes: 10,
};
const teams = ["a", "b", "c", "d", "e", "f", "g", "h"];
const MIN = 60_000;
const live = () => inserted.filter((r) => r.status !== "bye");

beforeEach(() => {
  inserted = [];
});

describe("baner for brakettkamper", () => {
  it("dobbel utslag m/ tidsplan: begge baner brukes av W1 og av senere L/GF-kamper", async () => {
    await buildDoubleElimMatches("t", teams, courts, { schedule });
    const w1 = inserted.filter((r) => r.bracket === "W" && r.round === 1);
    expect(new Set(w1.map((r) => r.court_id))).toEqual(new Set(courts));
    const later = inserted.filter((r) => r.bracket === "L" || r.bracket === "GF");
    expect(later.length).toBeGreaterThan(0);
    expect(new Set(later.map((r) => r.court_id)).size).toBe(2);
    expect(live().every((r) => courts.includes(r.court_id as string))).toBe(true);
  });

  it("ingen bane dobbeltbookes (slot = kamp + pause)", async () => {
    await buildDoubleElimMatches("t", teams, courts, { schedule });
    const seen = new Set<string>();
    for (const r of live()) {
      const k = `${r.court_id}@${r.scheduled_at}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    // samme bane: startene er minst matchMinutes + breakMinutes fra hverandre
    for (const c of courts) {
      const ts = live()
        .filter((r) => r.court_id === c)
        .map((r) => Date.parse(r.scheduled_at as string))
        .sort((x, y) => x - y);
      for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(15 * MIN);
    }
  });

  it("hviletid holdes: ingen lag spiller to kamper tettere enn kamp + hvile", async () => {
    await buildDoubleElimMatches("t", teams, courts, { schedule });
    const byTeam = new Map<string, number[]>();
    for (const r of live())
      for (const id of [r.home_team_id, r.away_team_id])
        if (id)
          byTeam.set(id as string, [...(byTeam.get(id as string) ?? []), Date.parse(r.scheduled_at as string)]);
    for (const ts of byTeam.values()) {
      ts.sort((x, y) => x - y);
      for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(20 * MIN);
    }
  });

  it("dobbel utslag uten tidsplan: jevn fordeling per runde", async () => {
    await buildDoubleElimMatches("t", teams, courts);
    expect(inserted.every((r) => r.scheduled_at === null)).toBe(true);
    const perRound = new Map<string, number[]>();
    for (const r of live()) {
      const k = `${r.bracket ?? "A"}:${r.round}`;
      const arr = perRound.get(k) ?? [0, 0];
      arr[courts.indexOf(r.court_id as string)]++;
      perRound.set(k, arr);
    }
    // W1 har 4 kamper → 2 + 2; ingen runde skjevere enn 1
    expect(perRound.get("W:1")).toEqual([2, 2]);
    for (const [a, b] of perRound.values()) expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    expect(new Set(live().map((r) => r.court_id)).size).toBe(2);
  });

  it("cup uten baner (sekvensiell): court_id forblir null", async () => {
    await buildCupMatches("t", teams, [], { schedule });
    expect(inserted.every((r) => r.court_id === null)).toBe(true);
  });

  it("cup m/ tidsplan: alle kamper får bane og runde 1 bruker begge", async () => {
    await buildCupMatches("t", teams, courts, { schedule });
    expect(live().every((r) => courts.includes(r.court_id as string))).toBe(true);
    const r1 = inserted.filter((r) => r.round === 1);
    expect(new Set(r1.map((r) => r.court_id))).toEqual(new Set(courts));
  });
});
