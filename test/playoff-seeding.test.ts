import { describe, it, expect, vi, beforeEach } from "vitest";

// B1 ende-til-ende: det EKTE sluttspillet (createTournament → advanceToPlayoff mot
// minnebutikken) har ingen gruppekamerater i første runde, og vinner/toer ligger i
// hver sin halvdel.

vi.mock("@/lib/server/store", async () => (await import("./helpers/memoryStore")).storeMock);

import { finishLeague, resetStore, storedMatches, storedTournament, storeMock } from "./helpers/memoryStore";
import { build, sched } from "./helpers/scenario";
import { advanceToPlayoff } from "@/lib/server/playoff";

beforeEach(() => resetStore());

async function playoffFor(teams: number, groupCount: number, advancePerGroup: number, extra: Record<string, unknown> = {}) {
  const schedule = sched();
  const r = await build({
    format: "group_playoff",
    teams,
    courts: 2,
    schedule,
    config: { groupCount, advancePerGroup, ...extra },
  });
  finishLeague(r.id, schedule);
  await advanceToPlayoff(storedTournament(r.id));
  const all = await storedMatches(r.id);
  const groupOf = new Map((await storeMock.getTeams(r.id)).map((t) => [t.id, t.group_no]));
  return { playoff: all.filter((m) => m.phase === "playoff" && (m.bracket ?? "A") === "A"), groupOf };
}

describe("sluttspill fra grupper (B1)", () => {
  it("3 grupper × 2 videre: ingen gruppekamerater møtes i første runde", async () => {
    const { playoff, groupOf } = await playoffFor(9, 3, 2);
    const r1 = playoff.filter((m) => m.round === 1 && m.home_team_id && m.away_team_id);
    expect(r1.length).toBeGreaterThan(0);
    for (const m of r1) expect(groupOf.get(m.home_team_id!), `${m.home_team_id} mot ${m.away_team_id}`).not.toBe(groupOf.get(m.away_team_id!));
  });

  it("4 grupper × 2 videre: vinner og toer i hver sin halvdel av braketten", async () => {
    const { playoff, groupOf } = await playoffFor(12, 4, 2);
    const r1 = playoff.filter((m) => m.round === 1);
    expect(r1).toHaveLength(4);
    const half = new Map<string, number>();
    for (const m of r1)
      for (const id of [m.home_team_id, m.away_team_id]) if (id) half.set(id, m.bracket_slot! < 2 ? 0 : 1);
    const byGroup = new Map<number, number[]>();
    for (const [id, h] of half) byGroup.set(groupOf.get(id)!, [...(byGroup.get(groupOf.get(id)!) ?? []), h]);
    expect(byGroup.size).toBe(4);
    for (const [g, halves] of byGroup) expect(new Set(halves).size, `gruppe ${g}`).toBe(2);
    for (const m of r1) expect(groupOf.get(m.home_team_id!)).not.toBe(groupOf.get(m.away_team_id!));
  });

  it("B-sluttspill fra grupper: heller ingen gruppekamerater i B-runde 1", async () => {
    const schedule = sched();
    const r = await build({
      format: "group_playoff",
      teams: 12,
      courts: 2,
      schedule,
      config: { groupCount: 3, advancePerGroup: 2, consolation: "b_playoff" },
    });
    finishLeague(r.id, schedule);
    await advanceToPlayoff(storedTournament(r.id));
    const all = await storedMatches(r.id);
    const groupOf = new Map((await storeMock.getTeams(r.id)).map((t) => [t.id, t.group_no]));
    const b1 = all.filter((m) => m.bracket === "B" && m.round === 1 && m.home_team_id && m.away_team_id);
    expect(b1.length).toBeGreaterThan(0);
    for (const m of b1) expect(groupOf.get(m.home_team_id!)).not.toBe(groupOf.get(m.away_team_id!));
  });
});
