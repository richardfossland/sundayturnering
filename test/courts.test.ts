import { describe, it, expect } from "vitest";
import {
  courtStrip,
  suggestNext,
  restRemaining,
  matchRest,
  busyTeams,
  courtFree,
  callError,
} from "@/lib/tournament/courts";
import type { Match } from "@/lib/types";

const NOW = Date.parse("2026-10-25T10:00:00.000Z");
const MIN = 60_000;
const at = (min: number) => new Date(NOW + min * MIN).toISOString();
const NOW_ISO = at(0);
const courts = [
  { id: "c1", name: "Bane 1", sort_order: 0 },
  { id: "c2", name: "Bane 2", sort_order: 1 },
];

type M = Pick<
  Match,
  "id" | "court_id" | "queue_order" | "scheduled_at" | "home_team_id" | "away_team_id" | "status" | "updated_at"
>;
let q = 0;
const m = (id: string, home: string | null, away: string | null, over: Partial<M> = {}): M => ({
  id,
  court_id: null,
  queue_order: q++,
  scheduled_at: null,
  home_team_id: home,
  away_team_id: away,
  status: "scheduled",
  updated_at: at(-60),
  ...over,
});

describe("restRemaining", () => {
  const done = m("d", "A", "B", { status: "done", updated_at: at(-6) });
  it("counts down from the last finished match", () => {
    expect(restRemaining("A", [done], NOW_ISO, 10)).toBe(4 * MIN);
    expect(restRemaining("B", [done], at(4), 10)).toBe(0);
  });
  it("is zero for a team that never played, with no min rest, or bad input", () => {
    expect(restRemaining("C", [done], NOW_ISO, 10)).toBe(0);
    expect(restRemaining("A", [done], NOW_ISO, 0)).toBe(0);
    expect(restRemaining("A", [done], "nope", 10)).toBe(0);
  });
  it("uses the latest finished match", () => {
    const later = m("d2", "A", "C", { status: "done", updated_at: at(-1) });
    expect(restRemaining("A", [done, later], NOW_ISO, 10)).toBe(9 * MIN);
  });
  it("matchRest picks the worst team", () => {
    const x = m("x", "A", "B");
    const d2 = m("d2", "B", "C", { status: "done", updated_at: at(-2) });
    expect(matchRest(x, [done, d2, x], NOW_ISO, 10)).toEqual({ teamId: "B", ms: 8 * MIN });
  });
});

describe("courtStrip", () => {
  it("gives live, called and the next scheduled per court, ordered by time", () => {
    const ms = [
      m("live", "A", "B", { status: "live", court_id: "c1" }),
      m("n2", "E", "F", { court_id: "c1", scheduled_at: at(30) }),
      m("n1", "C", "D", { court_id: "c1", scheduled_at: at(10) }),
      m("cal", "G", "H", { status: "called", court_id: "c2" }),
      m("tbd", "I", null, { court_id: "c2" }),
      m("fin", "J", "K", { status: "done", court_id: "c2" }),
    ];
    const [l1, l2] = courtStrip(ms, courts);
    expect(l1.live?.id).toBe("live");
    expect(l1.called).toBeNull();
    expect(l1.next.map((x) => x.id)).toEqual(["n1", "n2"]);
    expect(l2.live).toBeNull();
    expect(l2.called?.id).toBe("cal");
    expect(l2.next).toEqual([]);
  });
  it("limits `next` and sorts courts by sort_order", () => {
    const ms = [1, 2, 3, 4, 5].map((i) => m(`m${i}`, `a${i}`, `b${i}`, { court_id: "c1" }));
    const lanes = courtStrip(ms, [...courts].reverse(), 2);
    expect(lanes.map((l) => l.court.id)).toEqual(["c1", "c2"]);
    expect(lanes[0].next).toHaveLength(2);
  });
});

describe("suggestNext", () => {
  it("picks the earliest ready match for a free court (unpinned or pinned there)", () => {
    const ms = [
      m("late", "A", "B", { scheduled_at: at(20) }),
      m("other", "C", "D", { scheduled_at: at(1), court_id: "c2" }),
      m("early", "E", "F", { scheduled_at: at(5), court_id: "c1" }),
    ];
    expect(suggestNext("c1", ms, NOW_ISO, 0)?.id).toBe("early");
  });
  it("is null when the court is occupied", () => {
    const ms = [m("cal", "A", "B", { status: "called", court_id: "c1" }), m("x", "C", "D")];
    expect(suggestNext("c1", ms, NOW_ISO, 0)).toBeNull();
    expect(courtFree("c1", ms)).toBe(false);
  });
  it("skips matches with teams playing/called elsewhere or still resting", () => {
    const ms = [
      m("live", "A", "B", { status: "live", court_id: "c2" }),
      m("busy", "A", "C", { scheduled_at: at(1) }),
      m("rest", "D", "E", { scheduled_at: at(2) }),
      m("done", "D", "Z", { status: "done", updated_at: at(-3) }),
      m("ok", "F", "G", { scheduled_at: at(3) }),
    ];
    expect(busyTeams(ms)).toEqual(new Set(["A", "B"]));
    expect(suggestNext("c1", ms, NOW_ISO, 10)?.id).toBe("ok");
    // once D is rested, the earlier match wins
    expect(suggestNext("c1", ms, at(8), 10)?.id).toBe("rest");
  });
  it("ignores TBD matches and falls back to queue order without times", () => {
    const ms = [m("tbd", "A", null), m("q2", "B", "C", { queue_order: 50 }), m("q1", "D", "E", { queue_order: 40 })];
    expect(suggestNext("c1", ms, NOW_ISO, 0)?.id).toBe("q1");
    expect(suggestNext("c1", [ms[0]], NOW_ISO, 0)).toBeNull();
  });
});

describe("callError", () => {
  const ms = [m("a", "A", "B"), m("b", "C", "D", { status: "live", court_id: "c2" })];
  it("accepts a valid call", () => {
    expect(callError(ms[0], "c1", courts, ms)).toBeNull();
  });
  it("rejects bad state", () => {
    expect(callError(undefined, "c1", courts, ms)).toBe("kamp_ikke_klar");
    expect(callError(ms[1], "c1", courts, ms)).toBe("kamp_ikke_klar");
    expect(callError(ms[0], "zz", courts, ms)).toBe("bane_finnes_ikke");
    expect(callError(ms[0], "c2", courts, ms)).toBe("bane_opptatt");
    const clash = [ms[0], m("c", "A", "Z", { status: "called", court_id: "c2" })];
    expect(callError(ms[0], "c1", courts, clash)).toBe("lag_opptatt");
  });
});
