// Referee self-correct eligibility (spec extension). PURE so the security-
// relevant rules are unit-tested without a DB. A referee may fix THEIR OWN
// just-saved result, without the organiser code, only while the match is done,
// it was this device that saved it, and we're still inside the grace window.
//
// "This device saved it" is NOT decided from public data. The server stores
// `result_by` = HMAC(deviceSecret) + "|" + name, where deviceSecret is a random
// per-device value that never leaves the phone except in the save/correct
// request itself (lib/server/pair.ts `signOwnerTag`). The public match DTO
// carries only the name. The phone remembers which results it saved
// (identity.ownedResult → `Owned`) so the Endre button can show without the
// server telling anything; the server re-checks with the secret.

import { BRONZE_SLOT } from "@/lib/tournament/bracket";
import type { BracketId, Match, Tournament } from "@/lib/types";

/** How long after saving a result the saving device may still self-correct it. */
export const SELF_CORRECT_GRACE_MS = 4 * 60 * 1000;

/** What a phone remembers about a result it saved (see identity.ownedResult). */
export interface Owned {
  /** result_version the save produced; a later change (override, a second
   * device's correction) makes the match's version differ → no longer ours. */
  version: number;
}

/** Inside the grace window after the result was saved? */
export function inSelfCorrectWindow(
  match: Pick<Match, "updated_at">,
  nowMs: number,
  graceMs: number = SELF_CORRECT_GRACE_MS,
): boolean {
  const savedAt = Date.parse(match.updated_at);
  if (!Number.isFinite(savedAt)) return false;
  return nowMs - savedAt < graceMs;
}

/** Client side: may THIS phone offer «Endre» for this match right now? The
 * server decides authoritatively; this only keeps the button honest. */
export function canSelfCorrect(
  match: Pick<Match, "status" | "result_version" | "updated_at">,
  owned: Owned | null | undefined,
  nowMs: number,
  graceMs: number = SELF_CORRECT_GRACE_MS,
): boolean {
  if (match.status !== "done") return false;
  if (!owned || owned.version !== match.result_version) return false;
  return inSelfCorrectWindow(match, nowMs, graceMs);
}

/** Milliseconds left in the self-correct window (0 once expired). */
export function selfCorrectMsLeft(
  match: Pick<Match, "updated_at">,
  nowMs: number,
  graceMs: number = SELF_CORRECT_GRACE_MS,
): number {
  const savedAt = Date.parse(match.updated_at);
  if (!Number.isFinite(savedAt)) return 0;
  return Math.max(0, savedAt + graceMs - nowMs);
}

/** A match whose save can finish the tournament: playoff slot 0 in the bracket's
 * last round (a voided rematch, status `bye`, does not count as a round), or the
 * bronze final (main bracket A, slot 1 in the last round; migration 0020: the
 * tournament finishes when the LAST of final and bronze is decided). Its referee
 * may still correct it after the tournament status has flipped to `finished`. */
export function isDecidingFinal(
  match: Pick<Match, "phase" | "round" | "bracket_slot" | "bracket">,
  all: readonly Pick<Match, "phase" | "round" | "bracket" | "status">[],
): boolean {
  if (match.phase !== "playoff") return false;
  const bracket: BracketId = match.bracket ?? "A";
  // The last round of bracket A holds only the final (0) and the bronze (1).
  const bronze = match.bracket_slot === BRONZE_SLOT && bracket === "A";
  if (match.bracket_slot !== 0 && !bronze) return false;
  let last = 0;
  for (const m of all)
    if (m.phase === "playoff" && (m.bracket ?? "A") === bracket && m.status !== "bye")
      last = Math.max(last, m.round);
  return match.round >= last;
}

/** Why a finished match can no longer be corrected by a referee, given the
 * tournament it belongs to — the same guards the plain result route applies,
 * shared by the correct route and the Endre button. Null = allowed.
 *   turnering_avsluttet  tournament finished (except the deciding final)
 *   serien_avsluttet     league match after the playoff was seeded from the table
 *   runde_spilt          Swiss: a later round is already paired from this one */
export type CorrectBlock = "turnering_avsluttet" | "serien_avsluttet" | "runde_spilt";

export function correctBlock(
  t: Pick<Tournament, "status" | "format">,
  match: Pick<Match, "phase" | "round" | "bracket_slot" | "bracket">,
  all: readonly Pick<Match, "phase" | "round" | "bracket" | "status" | "bracket_slot">[],
): CorrectBlock | null {
  if (t.status === "finished" && !isDecidingFinal(match, all)) return "turnering_avsluttet";
  if (match.phase === "league" && t.status === "playoff") return "serien_avsluttet";
  if (t.format === "swiss" && match.phase === "league") {
    // Round N+1 was paired from the standings after round N; changing N now
    // would leave the pairing built on a result that no longer stands.
    const highest = all.reduce((hi, m) => (m.phase === "league" ? Math.max(hi, m.round) : hi), 0);
    if (match.round < highest) return "runde_spilt";
  }
  return null;
}
