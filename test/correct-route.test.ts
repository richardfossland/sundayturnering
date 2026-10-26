import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, Tournament } from "@/lib/types";

// L3 — «Endre» (match/correct) and who may use it.
//  C2  the same sperrer as «Lagre»: serien avsluttet, Swiss round already followed
//  C3  ownership = the phone's PRIVATE deviceSecret, never the (public) device id
//  C5  the deciding final stays correctable after saving it finished the cup
//  C6  propagation failure → one retry, then `propagated:false`

const ID = "11111111-1111-1111-1111-111111111111";
const MID = "22222222-2222-2222-2222-222222222222";
const SECRET = "device-secret-0123456789abcdef";
const OTHER_SECRET = "another-secret-0123456789abcdef";

let t: Tournament;
let m: Match;
let all: Match[] = [];
let rpcArgs: Record<string, unknown> | null = null;
let propagateFails = 0;
let propagateCalls = 0;

vi.mock("@/lib/server/store", () => ({
  getTournament: async () => t,
  getMatch: async () => m,
  getMatches: async () => all,
  db: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn.startsWith("code_") || fn === "register_code_failure") return { data: false, error: null };
      rpcArgs = args;
      return { data: [{ ...m, status: "done", result_version: m.result_version + 1, result_by: args.p_result_by }], error: null };
    },
  }),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));
vi.mock("@/lib/server/playoff", () => ({
  propagateResult: async () => {
    propagateCalls++;
    if (propagateFails-- > 0) throw new Error("db down");
    return false;
  },
  resetDownstream: async () => 0,
}));

import { POST } from "@/app/api/match/correct/route";
import { __resetRateLimiter } from "@/lib/server/http";
import { resultByFor } from "@/lib/server/pair";

function tournament(over: Partial<Tournament> = {}): Tournament {
  return {
    id: ID,
    control_code: "402815",
    board_code: "KOLE-FR",
    organiser_code: "ABCD-EF",
    organiser_id: null,
    title: "T",
    sport_label: "",
    format: "cup",
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: true },
    parallelism: "sequential",
    config: { playoffSize: 0, roundRobinDouble: false },
    status: "playoff",
    version: 0,
    timer: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}
async function doneMatch(over: Partial<Match> = {}): Promise<Match> {
  return {
    id: MID,
    tournament_id: ID,
    phase: "playoff",
    round: 1,
    bracket_slot: 0,
    group_no: null,
    court_id: null,
    queue_order: 0,
    scheduled_at: null,
    called_at: null,
    home_team_id: "h",
    away_team_id: "a",
    status: "done",
    result: { home: 2, away: 1 },
    winner_team_id: "h",
    locked_by: null,
    result_by: await resultByFor(SECRET, "Bane 1"),
    result_version: 4,
    updated_at: new Date().toISOString(),
    ...over,
  };
}
function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/match/correct", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "10.2.2.2" },
      body: JSON.stringify({
        matchId: MID,
        expectedVersion: 4,
        result: { home: 3, away: 1 },
        deviceId: "d1",
        deviceSecret: SECRET,
        deviceName: "Bane 1",
        controlCode: "402815",
        ...body,
      }),
    }),
  );
}
const code = async (r: Response) => (await r.json()).error;

beforeEach(async () => {
  t = tournament();
  m = await doneMatch();
  all = [];
  rpcArgs = null;
  propagateFails = 0;
  propagateCalls = 0;
  __resetRateLimiter();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("C3: ownership is a secret, not the public device id", () => {
  it("the saving phone (right secret) may correct", async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    expect(rpcArgs?.p_result).toEqual({ home: 3, away: 1 });
  });

  it("the stored result_by never contains the secret or the device id", async () => {
    expect(m.result_by).not.toContain(SECRET);
    expect(m.result_by).toMatch(/^o1\.[\w-]+\|Bane 1$/);
  });

  it("a different phone (other secret) is refused with 403 ikke_din_kamp", async () => {
    const res = await post({ deviceSecret: OTHER_SECRET });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("ikke_din_kamp");
    expect(rpcArgs).toBeNull();
  });

  it("knowing everything the PUBLIC state shows is not enough", async () => {
    // What a bystander can read: the name, and (old scheme) a device id.
    const res = await post({ deviceSecret: undefined, deviceId: "Bane 1" });
    expect(res.status).toBe(403);
    // Posting the stored tag itself as «secret» does not work either.
    const tag = m.result_by!.split("|")[0];
    expect((await post({ deviceSecret: tag })).status).toBe(403);
  });

  it("a legacy result (raw deviceId|name) can only be changed by the organiser", async () => {
    m = await doneMatch({ result_by: "d1|Bane 1" });
    expect((await post({ deviceId: "d1" })).status).toBe(403);
    m = await doneMatch({ result_by: "d1" });
    expect((await post({ deviceId: "d1" })).status).toBe(403);
    m = await doneMatch({ result_by: null });
    expect((await post({})).status).toBe(403);
  });

  it("a secret of the wrong shape never authorises", async () => {
    expect((await post({ deviceSecret: "" })).status).toBe(403);
    expect((await post({ deviceSecret: "short" })).status).toBe(403);
    expect((await post({ deviceSecret: 12345 })).status).toBe(403);
  });

  it("the correction keeps the owner (same tag), so a second correction still works", async () => {
    await post({});
    expect(rpcArgs?.p_result_by).toBe(m.result_by);
  });

  it("outside the 4-minute window → 409 for_sent", async () => {
    m = await doneMatch({ updated_at: new Date(Date.now() - 5 * 60_000).toISOString() });
    const res = await post({});
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("for_sent");
  });

  it("the control code is still checked first", async () => {
    const res = await post({ controlCode: "000000", deviceSecret: OTHER_SECRET });
    expect(await code(res)).toBe("feil_kontrollkode");
  });
});

describe("C2: the same sperrer as «Lagre»", () => {
  it("league match after the playoff was seeded → 409 serien_avsluttet", async () => {
    t = tournament({ format: "league_playoff", status: "playoff" });
    m = await doneMatch({ phase: "league", round: 3, bracket_slot: null });
    const res = await post({});
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("serien_avsluttet");
    expect(rpcArgs).toBeNull();
  });

  it("league match while the series is still on is fine", async () => {
    t = tournament({ format: "league_playoff", status: "league" });
    m = await doneMatch({ phase: "league", round: 3, bracket_slot: null });
    expect((await post({})).status).toBe(200);
  });

  it("Swiss: a round below the highest existing round → 409 runde_spilt", async () => {
    t = tournament({ format: "swiss", status: "league" });
    m = await doneMatch({ phase: "league", round: 2, bracket_slot: null });
    all = [m, await doneMatch({ id: "m3", phase: "league", round: 3, bracket_slot: null })];
    const res = await post({});
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("runde_spilt");
    expect(rpcArgs).toBeNull();
  });

  it("Swiss: the latest round may still be corrected", async () => {
    t = tournament({ format: "swiss", status: "league" });
    m = await doneMatch({ phase: "league", round: 3, bracket_slot: null });
    all = [await doneMatch({ id: "m2", phase: "league", round: 2, bracket_slot: null }), m];
    expect((await post({})).status).toBe(200);
  });
});

describe("C5: the deciding final after the cup finished", () => {
  const semi = (id: string, slot: number): Promise<Match> =>
    doneMatch({ id, round: 1, bracket_slot: slot, result_by: null });

  it("the final's referee may use Endre although the tournament is finished; propagation re-runs", async () => {
    t = tournament({ status: "finished" });
    m = await doneMatch({ round: 2, bracket_slot: 0 });
    all = [await semi("s1", 0), await semi("s2", 1), m, await doneMatch({ id: "bronze", round: 2, bracket_slot: 1, result_by: null })];
    const res = await post({ result: { home: 0, away: 1 } });
    expect(res.status).toBe(200);
    expect(rpcArgs?.p_winner_team_id).toBe("a");
    expect(propagateCalls).toBe(1);
  });

  it("a semifinal of a finished cup is still refused", async () => {
    t = tournament({ status: "finished" });
    m = await doneMatch({ round: 1, bracket_slot: 0 });
    all = [m, await semi("s2", 1), await doneMatch({ id: "f", round: 2, bracket_slot: 0, result_by: null })];
    const res = await post({});
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("turnering_avsluttet");
  });

  it("the bronze final of a finished cup is refused", async () => {
    t = tournament({ status: "finished" });
    m = await doneMatch({ round: 2, bracket_slot: 1 });
    all = [await doneMatch({ id: "f", round: 2, bracket_slot: 0, result_by: null }), m];
    expect(await code(await post({}))).toBe("turnering_avsluttet");
  });
});

describe("C6: propagation after commit", () => {
  it("one transient failure is retried → clean answer", async () => {
    propagateFails = 1;
    const res = await post({});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.propagated).toBeUndefined();
    expect(propagateCalls).toBe(2);
  });

  it("failing twice → 200 saved with propagated:false", async () => {
    propagateFails = 5;
    const res = await post({});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.propagated).toBe(false);
    expect(body.match.status).toBe("done");
    expect(propagateCalls).toBe(2);
  });
});

describe("public DTO", () => {
  it("the answer carries no tag or device id, only the name", async () => {
    const body = await (await post({})).json();
    expect(body.match.result_by).toBe("Bane 1");
    expect(JSON.stringify(body)).not.toContain("o1.");
  });
});
