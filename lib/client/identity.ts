"use client";

// Local persistence for a control device: a stable deviceId (for soft locks +
// Presence), an optional device name, and the organiser code once entered.
// Never holds authoritative tournament state — that is always refetched.

const DEVICE_ID = "turnering:deviceId";
const DEVICE_NAME = "turnering:deviceName";
const ORG_CODE = (id: string) => `turnering:org:${id}`;
const PINNED_COURT = (id: string) => `turnering:court:${id}`;
const CONTROL_CODE = (id: string) => `turnering:ctl:${id}`;

function rid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
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
      return "anon";
    }
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
      localStorage.setItem(ORG_CODE(id), code);
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
      else localStorage.removeItem(CONTROL_CODE(id));
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
