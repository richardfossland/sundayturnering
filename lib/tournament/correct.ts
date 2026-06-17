// Referee self-correct eligibility (spec extension). PURE so the security-
// relevant rule is unit-tested without a DB. A referee may fix THEIR OWN
// just-saved result, without the organiser code, only while the match is done,
// it was this device that saved it, and we're still inside the grace window.

import type { Match } from "@/lib/types";

/** How long after saving a result the saving device may still self-correct it. */
export const SELF_CORRECT_GRACE_MS = 4 * 60 * 1000;

export function canSelfCorrect(
  match: Pick<Match, "status" | "result_by" | "updated_at">,
  deviceId: string,
  nowMs: number,
  graceMs: number = SELF_CORRECT_GRACE_MS,
): boolean {
  if (match.status !== "done") return false;
  if (!deviceId) return false;
  if (!match.result_by) return false;
  if (match.result_by.split("|")[0] !== deviceId) return false;
  const savedAt = Date.parse(match.updated_at);
  if (!Number.isFinite(savedAt)) return false;
  return nowMs - savedAt < graceMs;
}

/** Milliseconds left in the self-correct window (0 once expired). */
export function selfCorrectMsLeft(
  match: Pick<Match, "result_by" | "updated_at">,
  nowMs: number,
  graceMs: number = SELF_CORRECT_GRACE_MS,
): number {
  const savedAt = Date.parse(match.updated_at);
  if (!Number.isFinite(savedAt)) return 0;
  return Math.max(0, savedAt + graceMs - nowMs);
}
