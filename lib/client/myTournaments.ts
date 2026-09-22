"use client";

// "Mine turneringer": the tournaments THIS device created, with their codes.
// The organiser code is shown once at creation and is the only credential for
// advance/override/finish on an anonymous tournament — before this list existed
// it lived only in the wizard's React state, so a Back press or reload after
// opening the board lost it for good. Device-local by design (no login).

import { identity } from "./identity";

export interface MyTournament {
  id: string;
  title: string;
  control_code: string;
  board_code: string;
  organiser_code: string;
  createdAt: string;
}

const KEY = "turnering:mine";
const MAX = 20;

function isRecord(v: unknown): v is MyTournament {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.control_code === "string" &&
    typeof r.board_code === "string" &&
    typeof r.organiser_code === "string"
  );
}

function write(list: MyTournament[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {}
}

export const myTournaments = {
  /** Newest first. Corrupt or foreign entries are dropped, never thrown. */
  list(): MyTournament[] {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isRecord).map((r) => ({
        ...r,
        title: typeof r.title === "string" ? r.title : "",
        createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
      }));
    } catch {
      return [];
    }
  },

  get(id: string): MyTournament | null {
    return myTournaments.list().find((t) => t.id === id) ?? null;
  },

  /** Remember a freshly created tournament and attach this device to it as
   * organiser, referee and board, so none of the codes has to be typed here. */
  remember(t: Omit<MyTournament, "createdAt"> & { createdAt?: string }) {
    const entry: MyTournament = {
      id: t.id,
      title: t.title,
      control_code: t.control_code,
      board_code: t.board_code,
      organiser_code: t.organiser_code,
      createdAt: t.createdAt ?? new Date().toISOString(),
    };
    write([entry, ...myTournaments.list().filter((x) => x.id !== t.id)]);
    identity.setOrganiserCode(t.id, t.organiser_code);
    identity.setControlCode(t.id, t.control_code);
    identity.setBoardCode(t.id, t.board_code);
  },

  /** Drop the tournament and every code this device holds for it. */
  forget(id: string) {
    write(myTournaments.list().filter((x) => x.id !== id));
    identity.forget(id);
  },
};
