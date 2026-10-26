import { describe, it, expect } from "vitest";
import {
  canSelfCorrect,
  correctBlock,
  inSelfCorrectWindow,
  isDecidingFinal,
  selfCorrectMsLeft,
  SELF_CORRECT_GRACE_MS,
} from "@/lib/tournament/correct";

const NOW = 1_700_000_000_000;
const isoAgo = (ms: number) => new Date(NOW - ms).toISOString();

function done(over: { result_version?: number; updated_at?: string } = {}) {
  return {
    status: "done" as const,
    result_version: 3,
    updated_at: isoAgo(30_000), // saved 30s ago
    ...over,
  };
}

describe("canSelfCorrect (client: «this phone saved it»)", () => {
  it("allows the phone that remembers this very version inside the window", () => {
    expect(canSelfCorrect(done(), { version: 3 }, NOW)).toBe(true);
  });

  it("rejects a phone that never saved this match", () => {
    expect(canSelfCorrect(done(), null, NOW)).toBe(false);
    expect(canSelfCorrect(done(), undefined, NOW)).toBe(false);
  });

  it("rejects when the result changed since (override / another correction)", () => {
    expect(canSelfCorrect(done({ result_version: 4 }), { version: 3 }, NOW)).toBe(false);
  });

  it("rejects once the window has expired", () => {
    expect(
      canSelfCorrect(done({ updated_at: isoAgo(SELF_CORRECT_GRACE_MS + 1000) }), { version: 3 }, NOW),
    ).toBe(false);
  });

  it("rejects a match that is not done", () => {
    expect(
      canSelfCorrect({ status: "live", result_version: 3, updated_at: isoAgo(1000) }, { version: 3 }, NOW),
    ).toBe(false);
  });

  it("rejects a malformed timestamp", () => {
    expect(canSelfCorrect(done({ updated_at: "not-a-date" }), { version: 3 }, NOW)).toBe(false);
  });
});

describe("inSelfCorrectWindow / selfCorrectMsLeft", () => {
  it("is the grace window", () => {
    expect(inSelfCorrectWindow(done(), NOW)).toBe(true);
    expect(inSelfCorrectWindow(done({ updated_at: isoAgo(SELF_CORRECT_GRACE_MS) }), NOW)).toBe(false);
  });
  it("counts down to zero", () => {
    expect(selfCorrectMsLeft(done({ updated_at: isoAgo(30_000) }), NOW)).toBe(
      SELF_CORRECT_GRACE_MS - 30_000,
    );
    expect(selfCorrectMsLeft(done({ updated_at: isoAgo(SELF_CORRECT_GRACE_MS + 5000) }), NOW)).toBe(0);
  });
});

// A cup with a bronze final: semis (round 1, slots 0/1) → final (round 2 slot 0)
// + bronze (round 2 slot 1).
const pm = (round: number, slot: number, status = "done", bracket?: "A" | "B" | "GF") =>
  ({ phase: "playoff" as const, round, bracket_slot: slot, status: status as "done", bracket });
const cup = [pm(1, 0), pm(1, 1), pm(2, 0), pm(2, 1)];

describe("isDecidingFinal (C5)", () => {
  it("is the last round's slot 0, or the A bronze final (L4: it can finish the tournament)", () => {
    expect(isDecidingFinal(cup[2], cup)).toBe(true);
    expect(isDecidingFinal(cup[3], cup)).toBe(true); // bronze
    expect(isDecidingFinal(cup[0], cup)).toBe(false); // a semifinal
    expect(isDecidingFinal(cup[1], cup)).toBe(false); // the other semifinal (slot 1, not last round)
  });
  it("bronze referee may correct after the tournament finished (correctBlock)", () => {
    const fin = { status: "finished" as const, format: "cup" as const };
    expect(correctBlock(fin, cup[3], cup)).toBeNull();
    expect(correctBlock(fin, cup[2], cup)).toBeNull();
    expect(correctBlock(fin, cup[1], cup)).toBe("turnering_avsluttet");
  });
  it("a slot-1 match in bracket B is never a bronze", () => {
    const all = [pm(1, 0, "done", "B"), pm(1, 1, "done", "B"), pm(2, 0, "done", "B")];
    expect(isDecidingFinal(all[1], all)).toBe(false);
  });
  it("is per bracket (the B-final counts in its own bracket)", () => {
    const all = [...cup, pm(1, 0, "done", "B"), pm(2, 0, "done", "B")];
    expect(isDecidingFinal(all[5], all)).toBe(true);
    expect(isDecidingFinal(all[4], all)).toBe(false);
  });
  it("a voided grand-final rematch (bye) does not make the grand final a semi", () => {
    const all = [pm(1, 0, "done", "GF"), pm(2, 0, "bye", "GF")];
    expect(isDecidingFinal(all[0], all)).toBe(true);
  });
  it("never a league match", () => {
    expect(isDecidingFinal({ phase: "league", round: 5, bracket_slot: 0 }, [])).toBe(false);
  });
});

describe("correctBlock (C2/C5): the same sperrer as «Lagre»", () => {
  const league = (round: number) => ({ phase: "league" as const, round, bracket_slot: null, status: "done" as const });

  it("nothing blocks a normal correction", () => {
    expect(correctBlock({ status: "league", format: "league" }, league(1), [league(1)])).toBeNull();
    expect(correctBlock({ status: "playoff", format: "cup" }, cup[0], cup)).toBeNull();
  });
  it("league match after the playoff was seeded → serien_avsluttet", () => {
    expect(correctBlock({ status: "playoff", format: "league_playoff" }, league(2), [league(2)])).toBe(
      "serien_avsluttet",
    );
  });
  it("finished tournament: only the deciding final may still be corrected", () => {
    const t = { status: "finished" as const, format: "cup" as const };
    expect(correctBlock(t, cup[2], cup)).toBeNull();
    expect(correctBlock(t, cup[0], cup)).toBe("turnering_avsluttet");
    expect(correctBlock(t, cup[3], cup)).toBeNull(); // bronze: may be the match that finished it (L4)
    expect(correctBlock({ status: "finished", format: "league" }, league(1), [league(1)])).toBe(
      "turnering_avsluttet",
    );
  });
  it("Swiss: a round below the highest existing round is refused", () => {
    const t = { status: "league" as const, format: "swiss" as const };
    const all = [league(1), league(2), league(3)];
    expect(correctBlock(t, league(1), all)).toBe("runde_spilt");
    expect(correctBlock(t, league(2), all)).toBe("runde_spilt");
    expect(correctBlock(t, league(3), all)).toBeNull();
  });
  it("round-robin league is not Swiss: earlier rounds stay correctable", () => {
    const all = [league(1), league(2)];
    expect(correctBlock({ status: "league", format: "league" }, league(1), all)).toBeNull();
  });
});
