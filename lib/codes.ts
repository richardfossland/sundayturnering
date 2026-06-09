// Code generation for the pairing scheme (spec §0.1, §2).
// Pure + injectable RNG so it is deterministic under test.
//
//   control_code   — 6 digits, what referee/control devices enter to attach.
//   board_code     — letters, to reopen the projector board view later.
//   organiser_code — letters, gates destructive actions (advance, override,
//                    re-seed, delete). Referees never see it.

// Ambiguous characters removed: I, O (letters) and 0, 1 (digits).
const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ"; // no I, O

export type Rng = () => number; // returns [0,1)

function pick(alphabet: string, rng: Rng): string {
  return alphabet[Math.floor(rng() * alphabet.length)];
}

/** 6-digit control code, e.g. "402815". Leading zeros allowed. */
export function generateControlCode(rng: Rng = Math.random): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += Math.floor(rng() * 10).toString();
  return code;
}

/** Board / organiser code: 4 letters + dash + 2 letters, e.g. "KOLE-FR".
 * No ambiguous characters, no digits (visually distinct from control code). */
export function generateWordCode(rng: Rng = Math.random): string {
  let head = "";
  for (let i = 0; i < 4; i++) head += pick(LETTERS, rng);
  let tail = "";
  for (let i = 0; i < 2; i++) tail += pick(LETTERS, rng);
  return `${head}-${tail}`;
}

/** Normalise a user-typed word code: uppercase, strip non-letters, re-dash. */
export function normalizeWordCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (cleaned.length !== 6) return input.trim().toUpperCase();
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

const CONTROL_RE = /^\d{6}$/;
export function isValidControlCode(input: string): boolean {
  return CONTROL_RE.test(input.trim());
}

/** Generate a code guaranteed unique against an existing set (retry on clash). */
export function generateUnique(
  gen: (rng: Rng) => string,
  taken: ReadonlySet<string>,
  rng: Rng = Math.random,
  maxTries = 50,
): string {
  for (let i = 0; i < maxTries; i++) {
    const code = gen(rng);
    if (!taken.has(code)) return code;
  }
  throw new Error("Kunne ikke generere en unik kode");
}
