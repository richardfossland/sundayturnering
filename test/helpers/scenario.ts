// Bygg-hjelper for tidsplantester: lager en turnering med det ekte
// `createTournament` mot minnebutikken (se memoryStore.ts).

import { createTournament, type CreateInput } from "@/lib/server/build";
import type { Format, ScheduleConfig, TournamentConfig } from "@/lib/types";
import { storedMatches, storedCourts } from "./memoryStore";

export const T0 = Date.parse("2026-10-25T09:00:00.000Z");

export const sched = (over: Partial<ScheduleConfig> = {}): ScheduleConfig => ({
  startAt: new Date(T0).toISOString(),
  matchMinutes: 10,
  breakMinutes: 0,
  minRestMinutes: 0,
  ...over,
});

export interface Scenario {
  format: Format;
  teams: number;
  courts: number;
  schedule?: ScheduleConfig;
  config?: Partial<TournamentConfig>;
}

export function createInput(s: Scenario): CreateInput {
  return {
    title: "ZZTEST",
    sport_label: "Fotball",
    format: s.format,
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: false },
    parallelism: s.courts > 0 ? "parallel" : "sequential",
    config: {
      playoffSize: 0,
      roundRobinDouble: false,
      thirdPlace: false,
      ...(s.schedule ? { schedule: s.schedule } : {}),
      ...s.config,
    },
    teams: Array.from({ length: s.teams }, (_, i) => ({ name: `Lag ${i + 1}`, colour: "#000000" })),
    courts: Array.from({ length: s.courts }, (_, i) => ({ name: `Bane ${i + 1}` })),
  };
}

export async function build(s: Scenario) {
  const res = await createTournament(createInput(s));
  return {
    id: res.id,
    matches: await storedMatches(res.id),
    courts: await storedCourts(res.id),
  };
}
