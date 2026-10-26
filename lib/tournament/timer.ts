// Countdown timer math (spec extension). PURE so it's unit-testable and shared
// by the organiser timer (tournament-level, sequential mode) and the referee
// timer (per-court, parallel mode). A malformed/absent endsAt is guarded so
// `add` can't crash on Date.parse → NaN.

import type { Match, Tournament, TimerState } from "@/lib/types";

export const TIMER_ACTIONS = ["start", "add", "stop"] as const;
export type TimerAction = (typeof TIMER_ACTIONS)[number];

/** Er verdien en kjent timer-handling? Ukjent `action` skal avvises (400), ikke
 * starte en 10-minutters nedtelling. */
export function isTimerAction(v: unknown): v is TimerAction {
  return typeof v === "string" && (TIMER_ACTIONS as readonly string[]).includes(v);
}

/** Hvilken nedtelling som skal nullstilles når `done` nettopp ble lagret som
 * ferdig: banens (kampen ligger på en bane) eller turneringens (sekvensiell, ingen
 * baner). Ikke hvis en annen kamp på samme bane/tidslinje fortsatt er i gang og
 * dermed bruker den. Ellers arver neste kamp en gammel nedtelling. */
export function timerToClear(
  done: Pick<Match, "id" | "court_id">,
  matches: Pick<Match, "id" | "court_id" | "status">[],
  parallelism: Tournament["parallelism"],
): { court: string } | "tournament" | null {
  const stillLive = (same: (m: { court_id: string | null }) => boolean) =>
    matches.some((m) => m.id !== done.id && m.status === "live" && same(m));
  if (done.court_id)
    return stillLive((m) => m.court_id === done.court_id) ? null : { court: done.court_id };
  // Uten bane: bare i sekvensiell modus ligger nedtellingen på turneringen. I
  // parallell modus er den turneringsnivå-klokka arrangørens til brettet.
  if (parallelism !== "sequential") return null;
  return stillLive(() => true) ? null : "tournament";
}

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
  // durationSec comes straight from a JSON body: a string or NaN used to reach
  // new Date(NaN).toISOString() and throw (a 500).
  const n = Number(durationSec ?? 600);
  const dur = Math.max(10, Math.min(7200, Math.floor(Number.isFinite(n) ? n : 600)));
  return {
    endsAt: new Date(nowMs + dur * 1000).toISOString(),
    durationSec: dur,
    running: true,
  };
}

/** Board-side view of a running timer at `nowMs`. PURE. The buzzer must only
 * sound when the expiry was observed live: a reload, reconnect or new tab that
 * loads an already-expired timer would otherwise buzz every time. «TID!» is
 * likewise dropped after a minute — a forgotten timer must not shout all day. */
export const BUZZ_WINDOW_MS = 3_000;
export const DONE_VISIBLE_MS = 60_000;

export function timerView(
  endsAtMs: number,
  nowMs: number,
): { remaining: number; expired: boolean; buzz: boolean; hidden: boolean } {
  const pastMs = nowMs - endsAtMs;
  const expired = pastMs >= 0;
  return {
    remaining: Math.max(0, Math.round((endsAtMs - nowMs) / 1000)),
    expired,
    buzz: expired && pastMs < BUZZ_WINDOW_MS,
    hidden: pastMs > DONE_VISIBLE_MS,
  };
}
