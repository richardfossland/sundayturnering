// Countdown timer math (spec extension). PURE so it's unit-testable and shared
// by the organiser timer (tournament-level, sequential mode) and the referee
// timer (per-court, parallel mode). A malformed/absent endsAt is guarded so
// `add` can't crash on Date.parse → NaN.

import type { TimerState } from "@/lib/types";

export function computeTimer(
  prev: TimerState | null,
  action: "start" | "add" | "stop",
  nowMs: number,
  durationSec?: number,
): TimerState | null {
  if (action === "stop") return null;

  if (action === "add") {
    const parsed = prev?.endsAt ? Date.parse(prev.endsAt) : NaN;
    const running = !!prev?.running && Number.isFinite(parsed);
    const base = running ? Math.max(nowMs, parsed) : nowMs;
    return {
      endsAt: new Date(base + 60_000).toISOString(),
      durationSec: (running ? (prev!.durationSec ?? 0) : 240) + 60,
      running: true,
    };
  }

  // start
  const dur = Math.max(10, Math.min(7200, Math.floor(durationSec ?? 600)));
  return {
    endsAt: new Date(nowMs + dur * 1000).toISOString(),
    durationSec: dur,
    running: true,
  };
}
