import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScheduleConfig } from "@/lib/types";

// Wiring: buildCupMatches (used by cup creation AND the league/group → playoff
// transition) stamps scheduled_at only when a schedule is given.

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
    inserted.map((r, i) => ({ id: `id${i}`, phase: "playoff", round: r.round, bracket_slot: r.bracket_slot })),
}));

import { buildCupMatches } from "@/lib/server/build";

const schedule: ScheduleConfig = {
  startAt: "2026-10-25T09:00:00.000Z",
  matchMinutes: 10,
  breakMinutes: 5,
  minRestMinutes: 0,
};

beforeEach(() => {
  inserted = [];
});

describe("buildCupMatches schedule wiring", () => {
  it("without a schedule every scheduled_at is null (as before)", async () => {
    await buildCupMatches("t", ["a", "b", "c", "d"], []);
    expect(inserted.length).toBe(3);
    expect(inserted.every((r) => r.scheduled_at === null)).toBe(true);
  });

  it("with a schedule: semis first, final after them; notBefore delays everything", async () => {
    await buildCupMatches("t", ["a", "b", "c", "d"], [], { schedule });
    const t = (round: number) =>
      inserted.filter((r) => r.round === round).map((r) => Date.parse(r.scheduled_at as string));
    expect(Math.min(...t(1))).toBe(Date.parse(schedule.startAt));
    expect(t(2)[0]).toBeGreaterThanOrEqual(Math.max(...t(1)) + 10 * 60_000);

    inserted = [];
    const later = new Date("2026-10-25T12:00:00.000Z");
    await buildCupMatches("t", ["a", "b", "c", "d"], [], { schedule, notBefore: later });
    expect(Math.min(...inserted.map((r) => Date.parse(r.scheduled_at as string)))).toBe(later.getTime());
  });

  it("byes get no time", async () => {
    await buildCupMatches("t", ["a", "b", "c"], [], { schedule });
    const bye = inserted.find((r) => r.status === "bye");
    expect(bye?.scheduled_at).toBeNull();
  });
});
