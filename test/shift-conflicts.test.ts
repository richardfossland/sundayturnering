import { describe, it, expect } from "vitest";
import {
  assignSlots,
  phaseCarryOver,
  planSlots,
  previewShift,
  shiftConflicts,
  type SlotLink,
} from "@/lib/tournament/schedule";
import type { Match, ScheduleConfig, TournamentStatus } from "@/lib/types";

const T0 = Date.parse("2026-10-25T09:00:00.000Z");
const MIN = 60_000;
const at = (min: number) => new Date(T0 + min * MIN).toISOString();
const cfg = (over: Partial<ScheduleConfig> = {}): ScheduleConfig => ({
  startAt: at(0),
  matchMinutes: 10,
  breakMinutes: 0,
  minRestMinutes: 0,
  ...over,
});

const C1 = "c1";
const C2 = "c2";

type M = Pick<Match, "id" | "court_id" | "status" | "scheduled_at" | "home_team_id" | "away_team_id" | "phase">;
const m = (
  id: string,
  min: number | null,
  court: string | null,
  home: string | null,
  away: string | null,
  over: Partial<M> = {},
): M => ({
  id,
  court_id: court,
  status: "scheduled",
  scheduled_at: min === null ? null : at(min),
  home_team_id: home,
  away_team_id: away,
  phase: "playoff",
  ...over,
});

/** Skyv `court`-kamper fra `from` med `minutes` og kjør konfliktsjekken. */
function shift(matches: M[], links: SlotLink[], courtId: string | null, minutes: number, c = cfg(), status?: TournamentStatus) {
  const { changes } = previewShift(matches, { courtId, fromIso: at(-1000), minutes, nowIso: at(-2000) });
  return shiftConflicts(matches, links, changes, c, status);
}

describe("shiftConflicts (A4)", () => {
  // Semi 1 (bane 1) og semi 2 (bane 2) kl. 0, finalen (bane 1) kl. 10.
  const ms = [
    m("s1", 0, C1, "a", "b"),
    m("s2", 0, C2, "c", "d"),
    m("fin", 10, C1, null, null),
  ];
  const links: SlotLink[] = [
    { from_match_id: "s1", to_match_id: "fin" },
    { from_match_id: "s2", to_match_id: "fin" },
  ];

  it("flytter alt likt: ingen nye konflikter", () => {
    expect(shift(ms, links, null, 15)).toEqual([]);
    expect(shift(ms, links, null, -5)).toEqual([]);
  });

  it("forsinker bare bane 2: semi 2 ender etter at finalen starter → mater-konflikt", () => {
    const cs = shift(ms, links, C2, 15);
    expect(cs).toEqual([{ kind: "feeder", matchId: "s2", otherId: "fin" }]);
  });

  it("framskynder bare finalens bane: finalen starter før semifinalen er ferdig", () => {
    const cs = shift(ms, links, C1, -5);
    expect(cs.map((c) => c.kind)).toContain("feeder");
  });

  it("samme lag får to samtidige kamper", () => {
    const two = [m("x", 0, C1, "a", "b"), m("y", 20, C2, "a", "e")];
    const cs = shift(two, [], C2, -15);
    expect(cs).toEqual([{ kind: "team_overlap", matchId: "y", otherId: "x" }]);
  });

  it("for kort hvile mellom lagets kamper", () => {
    const c = cfg({ minRestMinutes: 15 });
    const two = [m("x", 0, C1, "a", "b"), m("y", 30, C2, "a", "e")];
    expect(shift(two, [], C2, -10, c).map((k) => k.kind)).toEqual(["rest"]);
    // 5 min hvile var det ikke før heller: ikke en NY konflikt
    expect(shift(two, [], C2, 0 + 5, c)).toEqual([]);
  });

  it("to kamper på samme bane i samme slot", () => {
    const two = [m("x", 0, C1, "a", "b"), m("y", 10, C1, "c", "d")];
    expect(shift(two, [], null, 5)).toEqual([]);
    const cs = shiftConflicts(two, [], [{ matchId: "y", before: at(10), after: at(5) }], cfg());
    expect(cs).toEqual([{ kind: "court_overlap", matchId: "y", otherId: "x" }]);
  });

  it("feeder + hvile (TBD-lag): finalen må vente på mater + hvile", () => {
    const c = cfg({ minRestMinutes: 10 });
    const cs = shift(ms, links, C1, -5, c);
    expect(cs.some((k) => k.kind === "feeder" || k.kind === "rest")).toBe(true);
  });

  it("ignorerer ferdige, bye- og uspillbare kamper", () => {
    const withDone = [
      m("old", 0, C1, "a", "b", { status: "done" }),
      m("y", 20, C2, "a", "e"),
    ];
    expect(shift(withDone, [], C2, -20)).toEqual([]);
    // seriekamp etter at sluttspillet startet: kan ikke spilles, teller ikke
    const league = [
      m("l", 0, C1, "a", "b", { phase: "league" }),
      m("y", 20, C2, "a", "e"),
    ];
    expect(shift(league, [], C2, -20, cfg(), "playoff")).toEqual([]);
    expect(shift(league, [], C2, -20).map((k) => k.kind)).toEqual(["team_overlap"]);
  });
});

describe("planSlots priorEnds (A2)", () => {
  const one = (id: string, h: string, a: string, q = 0) => ({
    id,
    queue_order: q,
    court_id: null,
    home_team_id: h,
    away_team_id: a,
    status: "scheduled" as const,
  });

  it("et lag som nettopp spilte må hvile før første kamp i fasen", () => {
    const prior = new Map([["a", T0 + 10 * MIN]]);
    const r = planSlots([one("m", "a", "b")], ["c1"], cfg({ minRestMinutes: 20 }), { priorEnds: prior });
    expect(Date.parse(r.get("m")!.at)).toBe(T0 + 30 * MIN);
  });

  it("uten priorEnds som før; map-en røres ikke", () => {
    const prior = new Map([["a", T0 + 10 * MIN]]);
    const r = planSlots([one("m", "a", "b")], ["c1"], cfg({ minRestMinutes: 20 }));
    expect(Date.parse(r.get("m")!.at)).toBe(T0);
    planSlots([one("m", "a", "b")], ["c1"], cfg(), { priorEnds: prior });
    expect([...prior]).toEqual([["a", T0 + 10 * MIN]]);
  });

  it("endsOut gir hvert lags siste slutt (inkl. de som ikke spilte)", () => {
    const out = new Map<string, number>();
    planSlots([one("m", "a", "b")], [], cfg(), { priorEnds: new Map([["z", 5]]), endsOut: out });
    expect(Object.fromEntries(out)).toEqual({ a: T0 + 10 * MIN, b: T0 + 10 * MIN, z: 5 });
  });

  it("TBD-kamp: hvilen gjelder per mater (mater + hvile), ikke lagene", () => {
    const rows = [one("s1", "a", "b", 0), one("s2", "c", "d", 1), { ...one("fin", "", "", 2), home_team_id: null, away_team_id: null }];
    const links: SlotLink[] = [
      { from_match_id: "s1", to_match_id: "fin" },
      { from_match_id: "s2", to_match_id: "fin" },
    ];
    const r = assignSlots(rows, ["c1", "c2"], cfg({ minRestMinutes: 20 }), { links });
    expect(Date.parse(r.get("fin")!)).toBe(T0 + 10 * MIN + 20 * MIN);
  });
});

describe("phaseCarryOver (A3)", () => {
  type C = Parameters<typeof phaseCarryOver>[0][number];
  const row = (over: Partial<C>): C => ({
    phase: "league",
    status: "scheduled",
    scheduled_at: null,
    updated_at: at(0),
    home_team_id: "a",
    away_team_id: "b",
    ...over,
  });
  const now = T0 + 12 * MIN;

  it("alt ferdig: tidligst nå rundet opp til 5 min; lagene har faktisk slutt (opp til 5 min)", () => {
    const r = phaseCarryOver([row({ status: "done", scheduled_at: at(60), updated_at: at(7) })], cfg(), "playoff", now);
    expect(r.notBefore).toBe(T0 + 15 * MIN);
    expect(r.teamEnds.get("a")).toBe(T0 + 10 * MIN); // faktisk 09:07 → 09:10, ikke planlagt 10:10
  });

  it("uspilte seriekamper som ikke kan spilles, venter vi ikke på", () => {
    const r = phaseCarryOver([row({ scheduled_at: at(300) })], cfg(), "playoff", now);
    expect(r.notBefore).toBe(T0 + 15 * MIN);
    expect(r.teamEnds.size).toBe(0);
  });

  it("kamper som kan spilles og ikke er ferdige: planlagt slutt teller (aldri før nå)", () => {
    const r = phaseCarryOver([row({ status: "scheduled", scheduled_at: at(60) })], cfg(), "league", now);
    expect(r.notBefore).toBe(T0 + 70 * MIN);
    const live = phaseCarryOver([row({ status: "live", scheduled_at: at(0) })], cfg(), "league", now);
    expect(live.notBefore).toBe(T0 + 15 * MIN);
    expect(live.teamEnds.get("a")).toBe(now);
  });

  it("bye-kamper og kamper uten klokkeslett teller ikke", () => {
    const r = phaseCarryOver([row({ status: "bye" }), row({ status: "scheduled", scheduled_at: null })], cfg(), "league", now);
    expect(r.notBefore).toBe(T0 + 15 * MIN);
    expect(r.teamEnds.size).toBe(0);
  });
});
