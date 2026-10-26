import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Logikk-audit L1: kjør de EKTE byggerne (createTournament / advanceToPlayoff /
// insertSwissRound) mot en minnebutikk og sjekk invariantene på tvers av format ×
// antall lag × antall baner: ingen lag eller bane dobbeltbooket, hvile holdt (også
// over fasegrenser), materne ferdige før kampen de mater, alle baner i bruk.

vi.mock("@/lib/server/store", async () => (await import("./helpers/memoryStore")).storeMock);

import {
  checkSchedule,
  finishLeague,
  lastEnd,
  resetStore,
  storedLinks,
  storedMatches,
  storedTournament,
  usedCourts,
} from "./helpers/memoryStore";
import { build, sched, T0, type Scenario } from "./helpers/scenario";
import { advanceToPlayoff } from "@/lib/server/playoff";
import { insertSwissRound } from "@/lib/server/swiss";
import { estimateEnd } from "@/lib/tournament/estimate";
import { callCandidates } from "@/lib/tournament/courts";
import { splitIntoGroups } from "@/lib/tournament/groups";
import type { Format, Match } from "@/lib/types";

const MIN = 60_000;
const minutes = (ms: number) => (ms - T0) / MIN;

beforeEach(() => {
  resetStore();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0 - 60 * MIN); // «nå» er før start, så byggingen ikke flyttes
});
afterEach(() => vi.useRealTimers());

const setNow = (ms: number) => vi.setSystemTime(ms);

/** Ledige baner å forvente ved første runde: så mange kamper kan gå samtidig. */
function parallelism(s: Scenario): number {
  if (s.format === "league") return Math.floor(s.teams / 2);
  const groups = splitIntoGroups(
    Array.from({ length: s.teams }, (_, i) => `t${i}`),
    s.config?.groupCount ?? 2,
  );
  return groups.reduce((n, g) => n + Math.floor(g.length / 2), 0);
}

const LEAGUE_TEAMS = [2, 3, 4, 5, 6, 7, 8, 9, 12];
const COURTS = [0, 1, 2, 3, 4, 6];

describe("serie: alle baner i bruk, ingen kollisjoner (A1)", () => {
  for (const teams of LEAGUE_TEAMS)
    for (const courts of COURTS)
      it(`liga ${teams} lag, ${courts} baner`, async () => {
        const schedule = sched({ breakMinutes: 2, minRestMinutes: 10 });
        const s: Scenario = { format: "league", teams, courts, schedule };
        const r = await build(s);
        expect(checkSchedule(r.matches, schedule)).toEqual([]);
        if (courts > 0) {
          expect(usedCourts(r.matches).size).toBe(Math.min(courts, parallelism(s)));
          expect(r.matches.every((m) => m.status === "bye" || courts > 0 === !!m.court_id)).toBe(true);
        }
      });

  for (const teams of [4, 6, 8, 9, 12, 16])
    for (const groupCount of [2, 3, 4])
      for (const courts of [0, 2, 3, 6]) {
        if (teams / groupCount < 2) continue;
        it(`gruppespill ${teams} lag / ${groupCount} grupper, ${courts} baner`, async () => {
          const schedule = sched({ breakMinutes: 2, minRestMinutes: 10 });
          const s: Scenario = {
            format: "group_playoff",
            teams,
            courts,
            schedule,
            config: { groupCount, advancePerGroup: 1, playoffSize: 0 },
          };
          const r = await build(s);
          expect(checkSchedule(r.matches, schedule)).toEqual([]);
          if (courts > 0) expect(usedCourts(r.matches).size).toBe(Math.min(courts, parallelism(s)));
        });
      }

  it("12 lag / 3 grupper / 6 baner: gruppene går samtidig — 30 min i stedet for 90", async () => {
    const schedule = sched();
    const r = await build({
      format: "group_playoff",
      teams: 12,
      courts: 6,
      schedule,
      config: { groupCount: 3, advancePerGroup: 2 },
    });
    expect(minutes(lastEnd(r.matches, schedule))).toBe(30);
    expect(usedCourts(r.matches).size).toBe(6);
  });

  it("9 lag / 3 baner: enkel serie 120 min (var 180), dobbel serie 240 min", async () => {
    const schedule = sched();
    const r = await build({
      format: "league",
      teams: 9,
      courts: 3,
      schedule,
      config: { roundRobinDouble: true },
    });
    expect(r.matches.filter((m) => m.status !== "bye")).toHaveLength(72);
    // 72 kamper / 3 baner = 24 slots à 10 min; enkel serie (36 kamper): 12 slots
    expect(minutes(lastEnd(r.matches, schedule))).toBe(240);
    const single = await build({ format: "league", teams: 9, courts: 3, schedule });
    expect(minutes(lastEnd(single.matches, schedule))).toBe(120);
  });

  it("gruppene flettes i kø: runde 1 i alle grupper før runde 2", async () => {
    const r = await build({
      format: "group_playoff",
      teams: 12,
      courts: 6,
      schedule: sched(),
      config: { groupCount: 3, advancePerGroup: 2 },
    });
    const rounds = [...r.matches].sort((a, b) => a.queue_order - b.queue_order).map((m) => m.round);
    expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
  });

  it("uten tidsplan: én løpende banetteller gir alle baner kamper (gruppespill)", async () => {
    const r = await build({
      format: "group_playoff",
      teams: 12,
      courts: 6,
      config: { groupCount: 3, advancePerGroup: 2 },
    });
    expect(usedCourts(r.matches).size).toBe(6);
    const per = new Map<string, number>();
    for (const m of r.matches) if (m.court_id) per.set(m.court_id, (per.get(m.court_id) ?? 0) + 1);
    // 18 kamper på 6 baner: nøyaktig 3 hver.
    expect([...per.values()].every((n) => n === 3)).toBe(true);
  });

  it("uten tidsplan: liga 9 lag / 3 baner fordeles jevnt over hele serien", async () => {
    const r = await build({ format: "league", teams: 9, courts: 3 });
    const per = new Map<string, number>();
    for (const m of r.matches) if (m.court_id) per.set(m.court_id, (per.get(m.court_id) ?? 0) + 1);
    expect([...per.values()].sort()).toEqual([12, 12, 12]);
  });

  it("«Kall opp» har kamper å tilby på hver bane, også 3+", async () => {
    const r = await build({
      format: "group_playoff",
      teams: 12,
      courts: 6,
      schedule: sched(),
      config: { groupCount: 3, advancePerGroup: 2 },
    });
    for (const c of r.courts) expect(callCandidates(c.id, r.matches, "league").length).toBeGreaterThan(0);
  });
});

describe("braketter og sveitsisk: ingen kollisjoner", () => {
  const formats: Format[] = ["cup", "double_elim", "swiss"];
  for (const format of formats)
    for (const teams of [3, 4, 5, 8, 11, 16])
      for (const courts of [0, 1, 2, 3, 6])
        it(`${format} ${teams} lag, ${courts} baner`, async () => {
          const schedule = sched({ breakMinutes: 2, minRestMinutes: 10 });
          const r = await build({ format, teams, courts, schedule, config: { thirdPlace: format === "cup" } });
          expect(checkSchedule(r.matches, schedule, storedLinks())).toEqual([]);
        });
});

describe("estimat = faktisk bygging (A1)", () => {
  const flows: { name: string; s: Scenario }[] = [];
  for (const courts of [0, 1, 2, 3, 6]) {
    flows.push({ name: `liga 9 lag ${courts} baner`, s: { format: "league", teams: 9, courts } });
    flows.push({ name: `cup 8 lag ${courts} baner`, s: { format: "cup", teams: 8, courts, config: { thirdPlace: true } } });
    flows.push({
      name: `gruppespill 12/3 ${courts} baner`,
      s: { format: "group_playoff", teams: 12, courts, config: { groupCount: 3, advancePerGroup: 2, thirdPlace: true } },
    });
    flows.push({
      name: `liga + sluttspill 8 lag ${courts} baner`,
      s: { format: "league_playoff", teams: 8, courts, config: { playoffSize: 4 } },
    });
  }
  for (const { name, s } of flows)
    for (const rest of [0, 10])
      it(`${name}, hvile ${rest}`, async () => {
        const schedule = sched({ breakMinutes: 0, minRestMinutes: rest });
        const r = await build({ ...s, schedule });
        const est = estimateEnd({
          format: s.format,
          teamCount: s.teams,
          courtCount: s.courts,
          schedule,
          playoffSize: s.config?.playoffSize,
          groupCount: s.config?.groupCount,
          advancePerGroup: s.config?.advancePerGroup,
          thirdPlace: s.config?.thirdPlace,
        });
        let end = lastEnd(r.matches, schedule);
        if (s.format === "league_playoff" || s.format === "group_playoff") {
          // Serien spilles ferdig i rute, så bygges sluttspillet «nå».
          setNow(lastEnd(r.matches, schedule));
          finishLeague(r.id, schedule);
          await advanceToPlayoff(storedTournament(r.id));
          end = lastEnd(await storedMatches(r.id), schedule);
        }
        // Lagene i estimatet er plassholdere; med hvile kan fasegrensen avvike litt.
        if (rest === 0 || (s.format !== "league_playoff" && s.format !== "group_playoff"))
          expect(minutes(Date.parse(est.endsAt!))).toBe(minutes(end));
        else expect(Math.abs(minutes(Date.parse(est.endsAt!)) - minutes(end))).toBeLessThanOrEqual(rest);
      });
});

describe("hvile over fasegrenser (A2)", () => {
  it("liga → sluttspill: første sluttspillrunde respekterer hviletiden", async () => {
    const schedule = sched({ minRestMinutes: 20 });
    const r = await build({ format: "league_playoff", teams: 4, courts: 2, schedule, config: { playoffSize: 4 } });
    const seriesEnd = lastEnd(r.matches, schedule);
    setNow(seriesEnd); // serien ferdig i rute, sluttspillet bygges med en gang
    finishLeague(r.id, schedule);
    await advanceToPlayoff(storedTournament(r.id));
    const all = await storedMatches(r.id);
    const playoff = all.filter((m) => m.phase === "playoff");
    expect(checkSchedule(all, schedule, storedLinks(), (m) => m.phase === "playoff")).toEqual([]);
    // Semifinalene starter først 20 min etter siste serierunde.
    const first = Math.min(...playoff.filter((m) => m.round === 1).map((m) => Date.parse(m.scheduled_at!)));
    expect(first).toBeGreaterThanOrEqual(seriesEnd + 20 * MIN);
  });

  it("uten hviletid er sluttspillet i gang med en gang (ingen unødig forsinkelse)", async () => {
    const schedule = sched({ minRestMinutes: 0 });
    const r = await build({ format: "league_playoff", teams: 4, courts: 2, schedule, config: { playoffSize: 4 } });
    const seriesEnd = lastEnd(r.matches, schedule);
    setNow(seriesEnd);
    finishLeague(r.id, schedule);
    await advanceToPlayoff(storedTournament(r.id));
    const first = Math.min(
      ...(await storedMatches(r.id))
        .filter((m) => m.phase === "playoff" && m.status === "scheduled")
        .map((m) => Date.parse(m.scheduled_at!)),
    );
    expect(first).toBe(seriesEnd);
  });

  it("B-sluttspill: også B-brakettens første runde hviler", async () => {
    const schedule = sched({ minRestMinutes: 20 });
    const r = await build({
      format: "league_playoff",
      teams: 8,
      courts: 3,
      schedule,
      config: { playoffSize: 4, consolation: "b_playoff" },
    });
    setNow(lastEnd(r.matches, schedule));
    finishLeague(r.id, schedule);
    await advanceToPlayoff(storedTournament(r.id));
    const all = await storedMatches(r.id);
    expect(all.some((m) => m.bracket === "B")).toBe(true);
    expect(checkSchedule(all, schedule, storedLinks(), (m) => m.phase === "playoff")).toEqual([]);
  });

  it("gruppespill → sluttspill på tvers av baner", async () => {
    const schedule = sched({ minRestMinutes: 15, breakMinutes: 5 });
    const r = await build({
      format: "group_playoff",
      teams: 12,
      courts: 4,
      schedule,
      config: { groupCount: 3, advancePerGroup: 2 },
    });
    setNow(lastEnd(r.matches, schedule));
    finishLeague(r.id, schedule);
    await advanceToPlayoff(storedTournament(r.id));
    const all = await storedMatches(r.id);
    expect(checkSchedule(all, schedule, storedLinks(), (m) => m.phase === "playoff")).toEqual([]);
  });

  it("sveitsisk: neste runde hviler fra forrige rundes faktiske slutt", async () => {
    const schedule = sched({ minRestMinutes: 20 });
    const r = await build({ format: "swiss", teams: 8, courts: 2, schedule, config: { swiss: { rounds: 3 } } });
    const roundEnd = lastEnd(r.matches, schedule);
    setNow(roundEnd);
    finishLeague(r.id, schedule);
    await insertSwissRound(storedTournament(r.id), 2);
    const all = await storedMatches(r.id);
    expect(checkSchedule(all, schedule, [], (m) => m.round === 2)).toEqual([]);
    const second = all.filter((m) => m.round === 2 && m.status === "scheduled");
    expect(second.length).toBe(4);
    // Første lag ferdig var ferdig 10 min før rundens slutt (2 baner, 2 slots).
    expect(Math.min(...second.map((m) => Date.parse(m.scheduled_at!)))).toBe(roundEnd - 10 * MIN + 20 * MIN);
    // Banene velges av planleggeren: begge i bruk.
    expect(usedCourts(second as Match[]).size).toBe(2);
  });
});

describe("start for neste fase (A3)", () => {
  it("serien ferdig tidlig: sluttspillet starter nå, ikke etter planlagt slutt", async () => {
    const schedule = sched();
    const r = await build({ format: "league_playoff", teams: 6, courts: 1, schedule, config: { playoffSize: 4 } });
    const plannedEnd = lastEnd(r.matches, schedule); // 150 min
    const now = T0 + 45 * MIN;
    setNow(now);
    finishLeague(r.id, schedule, () => now - 7 * MIN); // alle ferdige for en stund siden
    await advanceToPlayoff(storedTournament(r.id));
    const playoff = (await storedMatches(r.id)).filter((m) => m.phase === "playoff");
    const first = Math.min(...playoff.filter((m) => m.status === "scheduled").map((m) => Date.parse(m.scheduled_at!)));
    expect(first).toBe(now); // 09:45 er allerede på 5 min
    expect(first).toBeLessThan(plannedEnd);
  });

  it("uspilte seriekamper som ikke kan spilles etter tidlig start teller ikke", async () => {
    const schedule = sched();
    const r = await build({ format: "league_playoff", teams: 6, courts: 1, schedule, config: { playoffSize: 4 } });
    const now = T0 + 22 * MIN; // 09:22 → 09:25
    setNow(now);
    // bare de to første kampene er spilt; resten ligger planlagt timer frem
    const all = await storedMatches(r.id);
    const firstTwo = all.filter((m) => m.status === "scheduled").slice(0, 2).map((m) => m.id);
    finishLeague(r.id, schedule, () => now - 3 * MIN);
    // gjenåpne alle utenom de to som «ikke spilt» (beholder planlagt tid)
    for (const m of all.filter((x) => !firstTwo.includes(x.id) && x.status === "scheduled")) {
      Object.assign(m, { status: "scheduled", result: null, winner_team_id: null });
    }
    const t = storedTournament(r.id);
    await advanceToPlayoff(t);
    const playoff = (await storedMatches(r.id)).filter((m) => m.phase === "playoff" && m.status === "scheduled");
    expect(Math.min(...playoff.map((m) => Date.parse(m.scheduled_at!)))).toBe(T0 + 25 * MIN);
  });

  it("sveitsisk: ferdig tidlig → neste runde starter nå", async () => {
    const schedule = sched({ matchMinutes: 20 });
    const r = await build({ format: "swiss", teams: 8, courts: 4, schedule, config: { swiss: { rounds: 3 } } });
    const now = T0 + 10 * MIN; // runde 1 var planlagt til 20 min
    setNow(now);
    finishLeague(r.id, schedule, () => now - 2 * MIN);
    await insertSwissRound(storedTournament(r.id), 2);
    const second = (await storedMatches(r.id)).filter((m) => m.round === 2);
    expect(Math.min(...second.map((m) => Date.parse(m.scheduled_at!)))).toBe(T0 + 10 * MIN);
  });
});
