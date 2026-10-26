import "server-only";

// Pairing token: proof that a device once presented the CORRECT control code
// for a tournament. Lets paired referee phones skip the per-IP wrong-code block
// (a school hall shares ONE public IP, so one pupil guessing wrong codes must
// never lock out every referee). Stateless: HMAC-SHA256(PAIR_SECRET,
// "ctl|<tournamentId>|<control_code>") — it stops verifying the moment the
// control code changes. Needs PAIR_SECRET (Worker secret). Missing in
// production → tokens are disabled and the code-block path applies as before
// (logged once, never a crash). Dev/test without the secret uses a fixed string.

const DEV_SECRET = "dev-only-pair-secret-do-not-use-in-production";
let warned = false;

export const PAIR_HEADER = "x-pair-token";

function secret(): string | null {
  const s = process.env.PAIR_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV !== "production") return DEV_SECRET;
  if (!warned) {
    warned = true;
    console.error("[pair] PAIR_SECRET missing in production – pairing tokens disabled");
  }
  return null;
}

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time string comparison. */
export function ctEqual(a: string, b: string): boolean {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Sign a token for (tournament, control code); null when tokens are disabled. */
export async function signPairToken(
  tournamentId: string,
  controlCode: string,
): Promise<string | null> {
  const s = secret();
  if (!s) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(s),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`ctl|${tournamentId}|${controlCode}`),
  );
  return b64url(sig);
}

/** True only for a token minted for exactly this tournament + control code. */
export async function verifyPairToken(
  tournamentId: string,
  controlCode: string,
  token: unknown,
): Promise<boolean> {
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return false;
  const expected = await signPairToken(tournamentId, controlCode);
  return expected !== null && ctEqual(expected, token);
}

/** Test-only: re-arm the one-time warning. */
export function __resetPairWarning(): void {
  warned = false;
}

// ---------- result ownership ----------
// Who may self-correct a just-saved result? The match row (and so the public
// state) used to carry the raw deviceId, which anyone could then post to
// /api/match/correct. Now the saving phone proves ownership with a random
// per-device `deviceSecret` that is never stored or served: the row keeps only
// HMAC(PAIR_SECRET, "own|" + deviceSecret). Even that is stripped from the
// public DTO (lib/dto.ts toMatchDTO). Without PAIR_SECRET (dev, or a missing
// production secret) the key falls back to a fixed string: the 128-bit
// deviceSecret is what makes the tag unguessable, the server key is extra.

/** deviceSecret as sent by the client: random, but bounded and printable. */
export function validDeviceSecret(v: unknown): v is string {
  return typeof v === "string" && v.length >= 16 && v.length <= 128 && /^[\w-]+$/.test(v);
}

/** Ownership tag stored in `matches.result_by` (before the `|name`). */
export async function signOwnerTag(deviceSecret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.PAIR_SECRET || DEV_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return "o1." + b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`own|${deviceSecret}`)));
}

/** `result_by` as stored: `<ownerTag>|<name>` (tag empty for a client that sent
 * no secret — it can never self-correct). */
export async function resultByFor(
  deviceSecret: unknown,
  deviceName: string | undefined,
): Promise<string | null> {
  const tag = validDeviceSecret(deviceSecret) ? await signOwnerTag(deviceSecret) : "";
  const name = (typeof deviceName === "string" ? deviceName : "").replace(/\|/g, "").slice(0, 40);
  return tag || name ? `${tag}|${name}` : null;
}

/** Does `resultBy` (stored) belong to the holder of `deviceSecret`? */
export async function ownsResult(resultBy: string | null, deviceSecret: unknown): Promise<boolean> {
  if (!resultBy || !validDeviceSecret(deviceSecret)) return false;
  return ctEqual(resultBy.split("|")[0], await signOwnerTag(deviceSecret));
}
