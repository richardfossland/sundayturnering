import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Match, Tournament } from "@/lib/types";

// L3 / C3 + C6 on the SAVE side: the result route stores an ownership tag (HMAC
// of the phone's private deviceSecret), never the raw device id, and a failed
// bracket propagation is retried once before `propagated:false` is reported.

const ID = "11111111-1111-1111-1111-111111111111";
const MID = "22222222-2222-2222-2222-222222222222";
const SECRET = "device-secret-0123456789abcdef";

let rpcArgs: Record<string, unknown> | null = null;
let propagateFails = 0;
let propagateCalls = 0;
const t = {
  id: ID,
  control_code: "402815",
  scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: true },
  status: "playoff",
} as unknown as Tournament;
const m = {
  id: MID,
  tournament_id: ID,
  phase: "playoff",
  home_team_id: "h",
  away_team_id: "a",
  status: "live",
  result_version: 0,
} as unknown as Match;

vi.mock("@/lib/server/store", () => ({
  getTournament: async () => t,
  getMatch: async () => m,
  db: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn.startsWith("code_") || fn === "register_code_failure") return { data: false, error: null };
      rpcArgs = args;
      return {
        data: [{ ...m, status: "done", result_version: 1, result_by: args.p_result_by, locked_by: "dev-1|Bane 1" }],
        error: null,
      };
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
}));

import { POST } from "@/app/api/match/result/route";
import { __resetRateLimiter } from "@/lib/server/http";
import { ownsResult, resultByFor, signOwnerTag, validDeviceSecret } from "@/lib/server/pair";

function save(extra: Record<string, unknown> = {}) {
  return POST(
    new Request("http://localhost/api/match/result", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "10.3.3.3" },
      body: JSON.stringify({
        matchId: MID,
        expectedVersion: 0,
        result: { home: 2, away: 1 },
        deviceId: "dev-1",
        deviceName: "Bane 1",
        controlCode: "402815",
        ...extra,
      }),
    }),
  );
}

beforeEach(() => {
  __resetRateLimiter();
  rpcArgs = null;
  propagateFails = 0;
  propagateCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("result_by is an ownership tag", () => {
  it("stores HMAC(secret)|name — no raw device id, no secret", async () => {
    await save({ deviceSecret: SECRET });
    const by = String(rpcArgs?.p_result_by);
    expect(by).toBe(`${await signOwnerTag(SECRET)}|Bane 1`);
    expect(by).not.toContain("dev-1");
    expect(by).not.toContain(SECRET);
    expect(await ownsResult(by, SECRET)).toBe(true);
    expect(await ownsResult(by, "another-secret-0123456789abcdef")).toBe(false);
  });

  it("a client without a secret (old build) saves fine but can never self-correct", async () => {
    const res = await save({});
    expect(res.status).toBe(200);
    const by = String(rpcArgs?.p_result_by);
    expect(by).toBe("|Bane 1");
    expect(by).not.toContain("dev-1");
    expect(await ownsResult(by, SECRET)).toBe(false);
  });

  it("the response never carries the lock holder's device id or the tag", async () => {
    const body = await (await save({ deviceSecret: SECRET })).json();
    expect(body.match.locked_by).toBe("Bane 1");
    expect(body.match.result_by).toBe("Bane 1");
  });

  it("junk secrets are ignored, not stored", async () => {
    await save({ deviceSecret: { evil: true }, deviceName: ["x"] });
    expect(rpcArgs?.p_result_by).toBeNull();
    expect(validDeviceSecret("short")).toBe(false);
    expect(validDeviceSecret("a|b|c-0123456789abcdef")).toBe(false);
    expect(validDeviceSecret(SECRET)).toBe(true);
  });

  it("resultByFor strips the separator from names", async () => {
    expect(await resultByFor(undefined, "A|B")).toBe("|AB");
    expect(await resultByFor(undefined, undefined)).toBeNull();
  });
});

describe("C6: propagation failure after the commit", () => {
  it("a transient failure is retried once and the referee hears nothing", async () => {
    propagateFails = 1;
    const body = await (await save({ deviceSecret: SECRET })).json();
    expect(body.propagated).toBeUndefined();
    expect(propagateCalls).toBe(2);
  });

  it("two failures → saved, propagated:false (and logged)", async () => {
    propagateFails = 9;
    const res = await save({ deviceSecret: SECRET });
    expect(res.status).toBe(200);
    expect((await res.json()).propagated).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});
