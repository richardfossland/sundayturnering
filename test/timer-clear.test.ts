import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, Tournament } from "@/lib/types";

// A6: nedtellingen nullstilles når kampen er ferdig (banens, eller turneringens i
// sekvensiell modus) — bortsett fra hvis en annen kamp på banen er i gang. Ukjent
// `action` skal være 400, ikke en 10-minutters nedtelling.

vi.mock("@/lib/server/store", async () => (await import("./helpers/memoryStore")).storeMock);
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));

import { resetStore, seed, storedCourts, storedTournament } from "./helpers/memoryStore";
import { clearTimerAfterDone } from "@/lib/server/timer";
import { isTimerAction, timerToClear } from "@/lib/tournament/timer";
import { POST as matchTimer } from "@/app/api/match/timer/route";
import { __resetRateLimiter } from "@/lib/server/http";

const TID = "00000000-0000-4000-8000-0000000000a1";
const C1 = "00000000-0000-4000-8000-0000000000c1";
const C2 = "00000000-0000-4000-8000-0000000000c2";
const TIMER = { endsAt: "2030-01-01T00:00:00.000Z", durationSec: 600, running: true };

const mm = (id: string, court: string | null, status: Match["status"]) =>
  ({ id, court_id: court, status }) as Pick<Match, "id" | "court_id" | "status">;

describe("timerToClear", () => {
  it("kampen på banen er ferdig → banens nedtelling", () => {
    expect(timerToClear(mm("a", C1, "done"), [mm("a", C1, "done"), mm("b", C1, "scheduled")], "parallel")).toEqual({
      court: C1,
    });
  });
  it("en annen kamp på samme bane er i gang → behold", () => {
    expect(timerToClear(mm("a", C1, "done"), [mm("a", C1, "done"), mm("b", C1, "live")], "parallel")).toBeNull();
  });
  it("live kamp på en ANNEN bane hindrer ikke", () => {
    expect(timerToClear(mm("a", C1, "done"), [mm("a", C1, "done"), mm("b", C2, "live")], "parallel")).toEqual({
      court: C1,
    });
  });
  it("sekvensiell: turneringens nedtelling, med mindre en annen kamp er live", () => {
    expect(timerToClear(mm("a", null, "done"), [mm("a", null, "done")], "sequential")).toBe("tournament");
    expect(timerToClear(mm("a", null, "done"), [mm("a", null, "done"), mm("b", null, "live")], "sequential")).toBeNull();
  });
  it("kamp uten bane i parallell modus: arrangørens brettklokke røres ikke", () => {
    expect(timerToClear(mm("a", null, "done"), [mm("a", null, "done")], "parallel")).toBeNull();
  });
});

describe("isTimerAction", () => {
  it("kjenner start/add/stop, ingenting annet", () => {
    expect(["start", "add", "stop"].every(isTimerAction)).toBe(true);
    for (const bad of ["pause", "", "START", 1, null, undefined, {}]) expect(isTimerAction(bad)).toBe(false);
  });
});

describe("clearTimerAfterDone", () => {
  beforeEach(() => {
    resetStore();
    seed("tournaments", [{ id: TID, parallelism: "parallel", timer: TIMER, status: "league" }]);
    seed("courts", [
      { id: C1, tournament_id: TID, name: "1", sort_order: 0, timer: TIMER },
      { id: C2, tournament_id: TID, name: "2", sort_order: 1, timer: TIMER },
    ]);
  });
  const t = (over: Partial<Tournament> = {}) => ({ ...storedTournament(TID), ...over }) as Tournament;
  const match = (id: string, court: string | null, status: Match["status"]) => ({
    id, tournament_id: TID, court_id: court, status,
  });

  it("nullstiller banens timer når kampen er ferdig", async () => {
    seed("matches", [match("m1", C1, "done"), match("m2", C1, "scheduled")]);
    expect(await clearTimerAfterDone(t(), match("m1", C1, "done") as unknown as Match)).toBe(true);
    const courts = await storedCourts(TID);
    expect(courts.find((c) => c.id === C1)!.timer).toBeNull();
    expect(courts.find((c) => c.id === C2)!.timer).toEqual(TIMER); // annen bane urørt
    expect(storedTournament(TID).timer).toEqual(TIMER);
  });

  it("beholder timeren når en annen kamp på banen er live", async () => {
    seed("matches", [match("m1", C1, "done"), match("m2", C1, "live")]);
    expect(await clearTimerAfterDone(t(), match("m1", C1, "done") as unknown as Match)).toBe(false);
    expect((await storedCourts(TID)).find((c) => c.id === C1)!.timer).toEqual(TIMER);
  });

  it("sekvensiell: nullstiller turneringens timer", async () => {
    storedTournament(TID).parallelism = "sequential";
    seed("matches", [match("m1", null, "done")]);
    expect(await clearTimerAfterDone(t(), match("m1", null, "done") as unknown as Match)).toBe(true);
    expect(storedTournament(TID).timer).toBeNull();
  });

  it("ingen nedtelling i gang: ingen skriving", async () => {
    seed("matches", [match("m1", C2, "done")]);
    (await storedCourts(TID))[1].timer = null;
    expect(await clearTimerAfterDone(t(), match("m1", C2, "done") as unknown as Match)).toBe(false);
  });

  it("feiler aldri (resultatet er allerede lagret)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = { ...t(), id: undefined } as unknown as Tournament;
    // getMatches finner ingenting → ingenting å gjøre; en kastende butikk fanges
    expect(await clearTimerAfterDone(bad, { id: "x", court_id: C1 } as unknown as Match)).toBe(false);
    spy.mockRestore();
  });
});

describe("timer-rutene: ukjent action → 400", () => {
  beforeEach(() => {
    __resetRateLimiter();
    resetStore();
  });
  const post = (route: typeof matchTimer, path: string, body: Record<string, unknown>) =>
    route(
      new Request(`http://localhost/api/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "10.9.9.9" },
        body: JSON.stringify(body),
      }),
    );

  it("/api/match/timer avviser pause før den starter noe", async () => {
    seed("tournaments", [{ id: TID, control_code: "402815", status: "league", timer: null }]);
    const res = await post(matchTimer, "match/timer", { tournamentId: TID, controlCode: "402815", action: "pause" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ugyldig_handling");
    expect(storedTournament(TID).timer).toBeNull();
  });

  it("/api/organiser/timer: ukjent action → 400, manglende action = start som før", async () => {
    vi.resetModules();
    vi.doMock("@/lib/server/auth", () => ({
      authOrganiserOrAdmin: async () => storedTournament(TID),
    }));
    seed("tournaments", [{ id: TID, organiser_code: "ABC", status: "league", timer: null }]);
    const { POST } = await import("@/app/api/organiser/timer/route");
    const bad = await post(POST, "organiser/timer", { tournamentId: TID, organiserCode: "ABC", action: "wat" });
    expect(bad.status).toBe(400);
    expect(storedTournament(TID).timer).toBeNull();
    const ok = await post(POST, "organiser/timer", { tournamentId: TID, organiserCode: "ABC" });
    expect(ok.status).toBe(200);
    expect(storedTournament(TID).timer).not.toBeNull();
    vi.doUnmock("@/lib/server/auth");
  });
});
