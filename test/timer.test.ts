import { describe, it, expect } from "vitest";
import { computeTimer } from "@/lib/tournament/timer";
import type { TimerState } from "@/lib/types";

const NOW = 1_700_000_000_000;

describe("computeTimer", () => {
  it("start sets a clamped duration and endsAt", () => {
    const t = computeTimer(null, "start", NOW, 600)!;
    expect(t.durationSec).toBe(600);
    expect(t.running).toBe(true);
    expect(Date.parse(t.endsAt!)).toBe(NOW + 600_000);
  });

  it("start clamps out-of-range durations", () => {
    expect(computeTimer(null, "start", NOW, 1)!.durationSec).toBe(10);
    expect(computeTimer(null, "start", NOW, 99_999)!.durationSec).toBe(7200);
  });

  it("stop returns null", () => {
    const prev: TimerState = { endsAt: new Date(NOW + 1000).toISOString(), durationSec: 60, running: true };
    expect(computeTimer(prev, "stop", NOW)).toBeNull();
  });

  it("add extends a running clock by 60s", () => {
    const prev: TimerState = {
      endsAt: new Date(NOW + 120_000).toISOString(),
      durationSec: 300,
      running: true,
    };
    const t = computeTimer(prev, "add", NOW)!;
    expect(Date.parse(t.endsAt!)).toBe(NOW + 180_000);
    expect(t.durationSec).toBe(360);
  });

  it("add on a malformed/absent timer starts a default clock (no crash)", () => {
    const t = computeTimer({ endsAt: "garbage", durationSec: 0, running: true }, "add", NOW)!;
    expect(t.running).toBe(true);
    expect(Date.parse(t.endsAt!)).toBe(NOW + 60_000);
  });
});

describe("computeTimer — malformed duration from a JSON body", () => {
  it("falls back to 10 minutes instead of throwing on NaN / strings", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    for (const bad of [Number.NaN, "abc" as unknown as number, Infinity]) {
      const t = computeTimer(null, "start", now, bad);
      expect(t?.durationSec).toBe(600);
    }
    expect(computeTimer(null, "start", now, "90" as unknown as number)?.durationSec).toBe(90);
  });
});
