import { describe, it, expect } from "vitest";
import { assignSlots, sanitiseSchedule, type SlotMatch, type SlotLink } from "@/lib/tournament/schedule";
import { generateRoundRobin } from "@/lib/tournament/roundRobin";
import { buildBracket } from "@/lib/tournament/bracket";
import type { ScheduleConfig } from "@/lib/types";

const T0 = Date.parse("2026-10-25T09:00:00.000Z");
const MIN = 60_000;
const at = (min: number) => new Date(T0 + min * MIN).toISOString();

const cfg = (over: Partial<ScheduleConfig> = {}): ScheduleConfig => ({
  startAt: at(0),
  matchMinutes: 10,
  breakMinutes: 5,
  minRestMinutes: 0,
  ...over,
});

function m(
  id: string,
  q: number,
  home: string | null,
  away: string | null,
  court: string | null = null,
): SlotMatch {
  return { id, queue_order: q, court_id: court, home_team_id: home, away_team_id: away, status: "scheduled" };
}

const min = (map: Map<string, string>, id: string) => (Date.parse(map.get(id)!) - T0) / MIN;

describe("assignSlots", () => {
  it("sequential: one timeline, slot = match + break, in queue order", () => {
    const out = assignSlots([m("a", 0, "1", "2"), m("b", 1, "3", "4"), m("c", 2, "1", "3")], [], cfg());
    expect([min(out, "a"), min(out, "b"), min(out, "c")]).toEqual([0, 15, 30]);
  });

  it("honours minimum rest per team", () => {
    // a and b share team 1; with 10 min match + 20 rest b cannot start before 30.
    const out = assignSlots([m("a", 0, "1", "2"), m("b", 1, "1", "3")], [], cfg({ minRestMinutes: 20 }));
    expect(min(out, "a")).toBe(0);
    expect(min(out, "b")).toBe(30);
  });

  it("never double-books a court and never plays a team twice at once", () => {
    const rr = generateRoundRobin(["a", "b", "c", "d", "e", "f"], { courtCount: 2 });
    const courts = ["c0", "c1"];
    const ms = rr
      .filter((p) => p.awayId)
      .map((p, i) => m(`m${i}`, p.queueOrder, p.homeId, p.awayId, courts[p.courtIndex!]));
    const out = assignSlots(ms, courts, cfg({ minRestMinutes: 5 }));
    expect(out.size).toBe(ms.length);
    const iv = ms.map((x) => ({ x, s: min(out, x.id) }));
    for (const a of iv)
      for (const b of iv) {
        if (a.x.id >= b.x.id) continue;
        const overlap = a.s < b.s + 10 && b.s < a.s + 10;
        if (a.x.court_id === b.x.court_id) expect(overlap).toBe(false);
        const shared = [a.x.home_team_id, a.x.away_team_id].some(
          (t) => t && (t === b.x.home_team_id || t === b.x.away_team_id),
        );
        if (shared) expect(a.s + 10 + 5 <= b.s || b.s + 10 + 5 <= a.s).toBe(true);
      }
  });

  it("parallel unpinned matches go to the earliest free court", () => {
    const out = assignSlots([m("a", 0, "1", "2"), m("b", 1, "3", "4")], ["c0", "c1"], cfg());
    expect(min(out, "a")).toBe(0);
    expect(min(out, "b")).toBe(0);
  });

  it("bracket matches wait for the matches feeding them (even with a free court)", () => {
    const b = buildBracket(["1", "2", "3", "4"], { thirdPlace: true });
    const key = (r: number, s: number) => `${r}:${s}`;
    const ms = b.matches.map((x, i) => m(key(x.round, x.slot), i, x.homeId, x.awayId, null));
    const links: SlotLink[] = b.links.map((l) => ({
      from_match_id: key(l.fromRound, l.fromSlot),
      to_match_id: key(l.toRound, l.toSlot),
    }));
    const out = assignSlots(ms, ["c0", "c1"], cfg({ minRestMinutes: 3 }), { links });
    for (const l of links)
      expect(min(out, l.to_match_id)).toBeGreaterThanOrEqual(min(out, l.from_match_id) + 10 + 3);
    // TBD teams still get a slot
    expect(out.has(key(2, 0))).toBe(true);
    expect(out.has(key(2, 1))).toBe(true);
  });

  it("places feeders before dependants even if the queue lists them later", () => {
    const ms = [m("final", 0, null, null), m("sf", 1, "1", "2")];
    const out = assignSlots(ms, [], cfg(), { links: [{ from_match_id: "sf", to_match_id: "final" }] });
    expect(min(out, "final")).toBeGreaterThan(min(out, "sf"));
  });

  it("group → playoff: notBefore pushes the bracket after the group stage", () => {
    const group = assignSlots([m("g1", 0, "1", "2"), m("g2", 1, "3", "4")], [], cfg());
    const lastEnd = Math.max(...[...group.values()].map((v) => Date.parse(v) + 10 * MIN));
    const po = assignSlots([m("p1", 0, "1", "3")], [], cfg(), { notBefore: new Date(lastEnd) });
    expect(Date.parse(po.get("p1")!)).toBeGreaterThanOrEqual(lastEnd);
  });

  it("courtBreaks: a closed court skips the break; a null index closes all courts", () => {
    const one = assignSlots(
      [m("a", 0, "1", "2", "c0"), m("b", 1, "3", "4", "c0"), m("c", 2, "5", "6", "c1")],
      ["c0", "c1"],
      cfg({ courtBreaks: [{ courtIndex: 0, from: at(10), to: at(40) }] }),
    );
    expect(min(one, "a")).toBe(0);
    expect(min(one, "b")).toBe(40);
    expect(min(one, "c")).toBe(0); // other court unaffected

    const all = assignSlots(
      [m("a", 0, "1", "2", "c0"), m("b", 1, "3", "4", "c1")],
      ["c0", "c1"],
      cfg({ courtBreaks: [{ courtIndex: null, from: at(-5), to: at(30) }] }),
    );
    expect(min(all, "a")).toBe(30);
    expect(min(all, "b")).toBe(30);
  });

  it("byes and non-scheduled matches get no time", () => {
    const out = assignSlots(
      [{ ...m("bye", 0, "1", null), status: "bye" }, { ...m("done", 1, "2", "3"), status: "done" }, m("x", 2, "4", "5")],
      [],
      cfg(),
    );
    expect([...out.keys()]).toEqual(["x"]);
    expect(min(out, "x")).toBe(0);
  });
});

describe("sanitiseSchedule", () => {
  it("absent = no schedule; garbage = invalid", () => {
    expect(sanitiseSchedule(undefined)).toBeUndefined();
    expect(sanitiseSchedule(null)).toBeUndefined();
    expect(sanitiseSchedule("x")).toBe("invalid");
    expect(sanitiseSchedule({ startAt: "nope", matchMinutes: 10 })).toBe("invalid");
    expect(sanitiseSchedule({ startAt: at(0), matchMinutes: "abc" })).toBe("invalid");
  });
  it("clamps numbers and normalises", () => {
    const s = sanitiseSchedule({ startAt: at(0), matchMinutes: 9999, breakMinutes: -3, minRestMinutes: 5 });
    expect(s).toMatchObject({ matchMinutes: 240, breakMinutes: 0, minRestMinutes: 5 });
  });
  it("validates courtBreaks", () => {
    expect(sanitiseSchedule({ startAt: at(0), matchMinutes: 10, courtBreaks: [{ from: at(5), to: at(1) }] })).toBe("invalid");
    const ok = sanitiseSchedule({ startAt: at(0), matchMinutes: 10, courtBreaks: [{ courtIndex: 1, from: at(5), to: at(9) }] });
    expect(ok).not.toBe("invalid");
  });
});
