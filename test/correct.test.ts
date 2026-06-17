import { describe, it, expect } from "vitest";
import {
  canSelfCorrect,
  selfCorrectMsLeft,
  SELF_CORRECT_GRACE_MS,
} from "@/lib/tournament/correct";

const NOW = 1_700_000_000_000;
const isoAgo = (ms: number) => new Date(NOW - ms).toISOString();

function done(over: { result_by?: string | null; updated_at?: string } = {}) {
  return {
    status: "done" as const,
    result_by: "dev-1|Bane 1",
    updated_at: isoAgo(30_000), // saved 30s ago
    ...over,
  };
}

describe("canSelfCorrect", () => {
  it("allows the saving device inside the grace window", () => {
    expect(canSelfCorrect(done(), "dev-1", NOW)).toBe(true);
  });

  it("rejects a different device", () => {
    expect(canSelfCorrect(done(), "dev-2", NOW)).toBe(false);
  });

  it("rejects once the window has expired", () => {
    expect(
      canSelfCorrect(done({ updated_at: isoAgo(SELF_CORRECT_GRACE_MS + 1000) }), "dev-1", NOW),
    ).toBe(false);
  });

  it("rejects when no device saved the result", () => {
    expect(canSelfCorrect(done({ result_by: null }), "dev-1", NOW)).toBe(false);
  });

  it("rejects a match that is not done", () => {
    expect(
      canSelfCorrect({ status: "live", result_by: "dev-1", updated_at: isoAgo(1000) }, "dev-1", NOW),
    ).toBe(false);
  });

  it("rejects a malformed timestamp", () => {
    expect(canSelfCorrect(done({ updated_at: "not-a-date" }), "dev-1", NOW)).toBe(false);
  });
});

describe("selfCorrectMsLeft", () => {
  it("counts down to zero", () => {
    expect(selfCorrectMsLeft(done({ updated_at: isoAgo(30_000) }), NOW)).toBe(
      SELF_CORRECT_GRACE_MS - 30_000,
    );
    expect(selfCorrectMsLeft(done({ updated_at: isoAgo(SELF_CORRECT_GRACE_MS + 5000) }), NOW)).toBe(0);
  });
});
