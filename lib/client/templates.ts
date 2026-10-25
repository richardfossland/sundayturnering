"use client";

// Reusable tournament setups saved in localStorage. Lets a teacher set up
// "7. trinn fotball" once and spin it up again next week in two taps.

import type { Consolation, Format, Parallelism, ScoringConfig, TiebreakPreset } from "@/lib/types";

/** Tidsplan i en mal: bare klokkeslett og varigheter, aldri startdatoen (en
 * mal gjenbrukes neste uke, da er datoen feil). */
export interface TemplateSchedule {
  on: boolean;
  /** "HH:mm" */
  startTime: string;
  matchMinutes: number;
  breakMinutes: number;
  minRestMinutes: number;
}

export interface TemplateData {
  title: string;
  sport: string;
  format: Format;
  scoring: ScoringConfig;
  parallelism: Parallelism;
  courtCount: number;
  courtNames: string[];
  playoffSize: 2 | 4 | 8;
  /** Added later — absent in older saved templates. */
  groupCount?: number;
  advancePerGroup?: number;
  thirdPlace?: boolean;
  /** Dobbel utslag: omkamp i finalen (eldre maler mangler den = ja). */
  grandFinalReset?: boolean;
  /** Added later — absent in older saved templates. */
  swissRounds?: number | null;
  tiebreak?: TiebreakPreset;
  consolation?: Consolation;
  schedule?: TemplateSchedule;
  teams: { name: string; colour: string; members: string[] }[];
}

/** «YYYY-MM-DDTHH:mm» (lokal) → «HH:mm». */
export function timeOfDay(local: string): string {
  return /T(\d{2}:\d{2})/.exec(local)?.[1] ?? "";
}

/** Behold datoen i `local`, bytt klokkeslettet. Ugyldig `hhmm` → `local` uendret. */
export function withTimeOfDay(local: string, hhmm: string): string {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return local;
  const date = local.split("T")[0];
  return date ? `${date}T${hhmm}` : local;
}

export interface Template {
  id: string;
  name: string;
  savedAt: number;
  data: TemplateData;
}

const KEY = "turnering:templates";

export const templates = {
  list(): Template[] {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Template[]) : [];
    } catch {
      return [];
    }
  },
  save(name: string, data: TemplateData): Template[] {
    const all = templates.list().filter((t) => t.name !== name);
    let id = "t" + all.length + name.length;
    try {
      id = crypto.randomUUID();
    } catch {}
    all.unshift({ id, name, savedAt: Date.now(), data });
    try {
      localStorage.setItem(KEY, JSON.stringify(all.slice(0, 20)));
    } catch {}
    return templates.list();
  },
  remove(id: string): Template[] {
    const all = templates.list().filter((t) => t.id !== id);
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {}
    return all;
  },
};
