"use client";

// Local persistence for a control device: a stable deviceId (for soft locks +
// Presence), an optional device name, and the organiser code once entered.
// Never holds authoritative tournament state — that is always refetched.

const DEVICE_ID = "turnering:deviceId";
const DEVICE_NAME = "turnering:deviceName";
const DEVICE_SECRET = "turnering:deviceSecret";
const OWNED = "turnering:owned";
/** How long a remembered save is worth keeping: well past the 4-minute window. */
const OWNED_TTL_MS = 15 * 60 * 1000;
const ORG_CODE = (id: string) => `turnering:org:${id}`;
const PINNED_COURT = (id: string) => `turnering:court:${id}`;
const CONTROL_CODE = (id: string) => `turnering:ctl:${id}`;
const PAIR_TOKEN = (id: string) => `turnering:pair:${id}`;
const BOARD_CODE = (id: string) => `turnering:board:${id}`;

function rid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

// Blocked storage (private mode) must not collapse every device to one shared
// id — that breaks soft locks and self-correct ownership. A per-page-load random
// id is stable enough within a session.
let memoryId: string | null = null;
let memorySecret: string | null = null;
let memoryOwned: Record<string, { v: number; at: number }> = {};

/** 128 random bits as hex; crypto.getRandomValues first, Math.random as a last
 * resort for ancient WebViews (the server also bounds what it accepts). */
function randomSecret(): string {
  try {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  } catch {
    return Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10).padEnd(8, "0")).join("");
  }
}

function readOwned(): Record<string, { v: number; at: number }> {
  try {
    const raw = JSON.parse(localStorage.getItem(OWNED) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return memoryOwned;
  }
}

export const identity = {
  deviceId(): string {
    try {
      let v = localStorage.getItem(DEVICE_ID);
      if (!v) {
        v = rid();
        localStorage.setItem(DEVICE_ID, v);
      }
      return v;
    } catch {
      return (memoryId ??= rid());
    }
  },
  /** Private per-device secret. Unlike deviceId (which travels in locks and
   * presence) it is sent ONLY with result saves/corrections: the server keeps
   * an HMAC of it, and it is what authorises «Endre» on a result this phone
   * saved. Never shown, never in a URL. */
  deviceSecret(): string {
    try {
      let v = localStorage.getItem(DEVICE_SECRET);
      if (!v || v.length < 16) {
        v = randomSecret();
        localStorage.setItem(DEVICE_SECRET, v);
      }
      return v;
    } catch {
      return (memorySecret ??= randomSecret());
    }
  },
  /** Remember that THIS phone saved a result (at `version`), so «Endre» can be
   * offered. Nothing about who saved it is public, so the phone keeps its own
   * short list; old entries are pruned on every write. */
  markOwned(matchId: string, version: number) {
    const now = Date.now();
    const next: Record<string, { v: number; at: number }> = {};
    for (const [id, e] of Object.entries(readOwned()))
      if (e && now - e.at < OWNED_TTL_MS) next[id] = e;
    next[matchId] = { v: version, at: now };
    memoryOwned = next;
    try {
      localStorage.setItem(OWNED, JSON.stringify(next));
    } catch {}
  },
  /** The result_version this phone saved for a match, or null. */
  ownedResult(matchId: string): { version: number } | null {
    const e = readOwned()[matchId];
    if (!e || Date.now() - e.at >= OWNED_TTL_MS) return null;
    return { version: e.v };
  },
  deviceName(): string {
    try {
      return localStorage.getItem(DEVICE_NAME) ?? "";
    } catch {
      return "";
    }
  },
  setDeviceName(name: string) {
    try {
      localStorage.setItem(DEVICE_NAME, name);
    } catch {}
  },
  organiserCode(id: string): string {
    try {
      return localStorage.getItem(ORG_CODE(id)) ?? "";
    } catch {
      return "";
    }
  },
  setOrganiserCode(id: string, code: string) {
    try {
      if (code) localStorage.setItem(ORG_CODE(id), code);
      else localStorage.removeItem(ORG_CODE(id));
    } catch {}
  },
  /** The six-digit control code this device attached with, per tournament.
   * It is the referee credential every write route requires (tournament and
   * match ids are public), so /kontroll/[id] re-prompts for it when absent. */
  controlCode(id: string): string | null {
    try {
      return localStorage.getItem(CONTROL_CODE(id));
    } catch {
      return null;
    }
  },
  setControlCode(id: string, code: string | null) {
    try {
      if (code) localStorage.setItem(CONTROL_CODE(id), code);
      else {
        localStorage.removeItem(CONTROL_CODE(id));
        localStorage.removeItem(PAIR_TOKEN(id)); // token is bound to that code
      }
    } catch {}
  },
  /** Pairing token the server issued for this device's control code (see
   * lib/server/pair.ts). Lives and dies with the control code. */
  pairToken(id: string): string | null {
    try {
      return localStorage.getItem(PAIR_TOKEN(id));
    } catch {
      return null;
    }
  },
  setPairToken(id: string, token: string | null | undefined) {
    try {
      if (token) localStorage.setItem(PAIR_TOKEN(id), token);
      else localStorage.removeItem(PAIR_TOKEN(id));
    } catch {}
  },
  /** The word board code for a tournament this device created or reopened via
   * /tavle. Held so the board can show its codes overlay (the public state
   * endpoint never carries them). */
  boardCode(id: string): string | null {
    try {
      return localStorage.getItem(BOARD_CODE(id));
    } catch {
      return null;
    }
  },
  setBoardCode(id: string, code: string | null) {
    try {
      if (code) localStorage.setItem(BOARD_CODE(id), code);
      else localStorage.removeItem(BOARD_CODE(id));
    } catch {}
  },
  /** Remove every per-tournament key this device holds. */
  forget(id: string) {
    try {
      for (const key of [ORG_CODE(id), CONTROL_CODE(id), PAIR_TOKEN(id), BOARD_CODE(id), PINNED_COURT(id)])
        localStorage.removeItem(key);
    } catch {}
  },
  pinnedCourt(id: string): string | null {
    try {
      return localStorage.getItem(PINNED_COURT(id));
    } catch {
      return null;
    }
  },
  setPinnedCourt(id: string, courtId: string | null) {
    try {
      if (courtId) localStorage.setItem(PINNED_COURT(id), courtId);
      else localStorage.removeItem(PINNED_COURT(id));
    } catch {}
  },
};
