import { describe, it, expect } from "vitest";
import {
  canonicaliseResult,
  resolve,
  validateResult,
  defaultScoringConfig,
} from "@/lib/tournament/scoring";
import { planDownstreamReset } from "@/lib/tournament/downstream";
import type { Match } from "@/lib/types";

const simple = defaultScoringConfig("simple"); // allowDraw: true

describe("a level score in a knockout match needs a decider", () => {
  it("league: 1–1 is a draw (decider ignored and stripped)", () => {
    const raw = { home: 1, away: 1, decider: "home" };
    expect(validateResult("simple", raw, simple)).toBeNull();
    const r = canonicaliseResult("simple", raw);
    expect(r).toEqual({ home: 1, away: 1 });
    expect(resolve("simple", r).winner).toBe("draw");
  });

  it("knockout: 1–1 without a decider is refused, even when draws are allowed", () => {
    expect(validateResult("simple", { home: 1, away: 1 }, simple, { knockout: true })).toMatch(
      /velg hvem som gikk videre/,
    );
  });

  it("knockout: 1–1 with a decider crowns that team and shows (str.)", () => {
    const raw = { home: 1, away: 1, decider: "away" };
    expect(validateResult("simple", raw, simple, { knockout: true })).toBeNull();
    const r = canonicaliseResult("simple", raw, { knockout: true });
    expect(r).toEqual({ home: 1, away: 1, decider: "away" });
    const res = resolve("simple", r);
    expect(res.winner).toBe("away");
    expect(res.display).toBe("1–1 (str.)");
  });

  it("knockout: a decisive score drops a stray decider", () => {
    const r = canonicaliseResult("simple", { home: 2, away: 1, decider: "away" }, { knockout: true });
    expect(r).toEqual({ home: 2, away: 1 });
    expect(resolve("simple", r).winner).toBe("home");
  });

  it("rejects absurd scores (final results had no cap)", () => {
    expect(validateResult("simple", { home: 1000, away: 0 }, simple)).toMatch(/Urimelig/);
    const sets = defaultScoringConfig("sets");
    expect(validateResult("sets", { sets: [[1000, 0]] }, sets)).toMatch(/gyldige/);
  });
});

// Bracket: QF1,QF2 → SF1 → F ; SF1,SF2 losers → bronze B
const links = [
  { from_match_id: "QF1", to_match_id: "SF1", to_slot: "home" as const },
  { from_match_id: "QF2", to_match_id: "SF1", to_slot: "away" as const },
  { from_match_id: "SF1", to_match_id: "F", to_slot: "home" as const },
  { from_match_id: "SF2", to_match_id: "F", to_slot: "away" as const },
  { from_match_id: "SF1", to_match_id: "B", to_slot: "home" as const },
  { from_match_id: "SF2", to_match_id: "B", to_slot: "away" as const },
];
const status = (s: Record<string, Match["status"]>) =>
  Object.entries(s).map(([id, st]) => ({ id, status: st }));

describe("planDownstreamReset", () => {
  it("nothing to reset while the next round is unplayed", () => {
    const plan = planDownstreamReset(
      "QF1",
      links,
      status({ QF1: "done", QF2: "done", SF1: "scheduled", SF2: "scheduled", F: "scheduled", B: "scheduled" }),
    );
    expect(plan).toEqual({ reset: [], clearSlots: [] });
  });

  it("QF overridden after the semi AND the final were played → both reset, their slots cleared", () => {
    const plan = planDownstreamReset(
      "QF1",
      links,
      status({ QF1: "done", QF2: "done", SF1: "done", SF2: "done", F: "done", B: "live" }),
    );
    expect(plan.reset).toEqual(["SF1", "F", "B"]);
    // SF1's own slot is refilled by propagation (root); what SF1 fed is unknown now
    expect(plan.clearSlots).toEqual([
      { matchId: "F", slot: "home" },
      { matchId: "B", slot: "home" },
    ]);
  });

  it("a live match counts as started", () => {
    const plan = planDownstreamReset(
      "SF1",
      links,
      status({ SF1: "done", SF2: "done", F: "live", B: "scheduled" }),
    );
    expect(plan.reset).toEqual(["F"]);
  });
});
