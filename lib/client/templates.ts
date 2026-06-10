"use client";

// Reusable tournament setups saved in localStorage. Lets a teacher set up
// "7. trinn fotball" once and spin it up again next week in two taps.

import type { Format, Parallelism, ScoringConfig } from "@/lib/types";

export interface TemplateData {
  title: string;
  sport: string;
  format: Format;
  scoring: ScoringConfig;
  parallelism: Parallelism;
  courtCount: number;
  courtNames: string[];
  playoffSize: 2 | 4 | 8;
  teams: { name: string; colour: string; members: string[] }[];
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
