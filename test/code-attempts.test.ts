import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tournament } from "@/lib/types";

// Shared-IP-safe guess protection: only WRONG codes are counted, a blocked IP
// gets 429 (own message on the client, not «feil kode»), and if the attempts
// RPC itself fails the limiter fails OPEN.

const ID = "11111111-1111-1111-1111-111111111111";
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
let rpc: Rpc;
const t: Tournament = {
  id: ID,
  control_code: "402815",
  board_code: "KOLE-FR",
  organiser_code: "ABCD-EF",
  organiser_id: null,
  title: "T",
  sport_label: "",
  format: "league",
  scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: false },
  parallelism: "sequential",
  config: { playoffSize: 0, roundRobinDouble: false },
  status: "league",
  version: 0,
  timer: null,
  created_at: "",
};

vi.mock("@/lib/server/store", () => ({
  getTournament: async () => t,
  getTournamentByControlCode: async (c: string) => (c === "402815" ? t : null),
  getTournamentByBoardCode: async () => null,
  db: () => ({ rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args) }),
}));
vi.mock("@/lib/supabase/auth-server", () => ({
  createAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

import { authOrganiserOrAdmin, checkControlCode } from "@/lib/server/auth";
import { POST as attach } from "@/app/api/attach/route";
import { withApi, __resetRateLimiter } from "@/lib/server/http";
import { errorMessage, pairErrorMessage } from "@/lib/locale/errors";
import { ApiError } from "@/lib/client/api";

const calls: { fn: string; args: Record<string, unknown> }[] = [];
let blocked = false;
function req(ip = "10.9.9.9", body: unknown = {}) {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  calls.length = 0;
  blocked = false;
  __resetRateLimiter();
  vi.spyOn(console, "error").mockImplementation(() => {});
  rpc = async (fn, args) => {
    calls.push({ fn, args });
    return { data: fn === "code_blocked" ? blocked : false, error: null };
  };
});

describe("code attempt limiter", () => {
  it("wrong control code registers a failure (20 / 10 min per scope+IP)", async () => {
    expect(await checkControlCode(req(), t, "000000")).toBe(false);
    const f = calls.find((c) => c.fn === "register_code_failure");
    expect(f?.args).toEqual({ p_scope: ID, p_ip: "10.9.9.9", p_window_s: 600, p_max: 20 });
  });

  it("correct control code is never counted", async () => {
    expect(await checkControlCode(req(), t, "402815")).toBe(true);
    expect(calls.map((c) => c.fn)).toEqual(["code_blocked"]);
  });

  it("blocked → RateLimitedError → 429 for_mange_forsok via withApi", async () => {
    blocked = true;
    const route = withApi(async (r: Request) => {
      await checkControlCode(r, t, "402815");
      return Response.json({ ok: true });
    });
    const res = await route(req());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "for_mange_forsok" });
  });

  it("the failure that crosses the limit answers 429 immediately", async () => {
    rpc = async (fn) => ({ data: fn === "register_code_failure", error: null });
    await expect(checkControlCode(req(), t, "000000")).rejects.toThrow("for_mange_forsok");
  });

  it("organiser code: wrong code counts under org:<id>; right code does not", async () => {
    expect(await authOrganiserOrAdmin(ID, "WRONG-1", req())).toBeNull();
    expect(calls.find((c) => c.fn === "register_code_failure")?.args.p_scope).toBe(`org:${ID}`);
    calls.length = 0;
    expect((await authOrganiserOrAdmin(ID, "abcd-ef", req()))?.id).toBe(ID);
    expect(calls.some((c) => c.fn === "register_code_failure")).toBe(false);
  });

  it("attach: unknown code counts under 'attach'; blocked → 429", async () => {
    const miss = await attach(req("10.1.1.1", { controlCode: "999999" }));
    expect(miss.status).toBe(404);
    expect(calls.find((c) => c.fn === "register_code_failure")?.args.p_scope).toBe("attach");
    blocked = true;
    const res = await attach(req("10.1.1.2", { controlCode: "402815" }));
    expect(res.status).toBe(429);
  });

  it("fails OPEN when the RPC errors or throws", async () => {
    rpc = async () => ({ data: null, error: { message: "boom" } });
    expect(await checkControlCode(req(), t, "402815")).toBe(true);
    expect(await checkControlCode(req(), t, "000000")).toBe(false); // plain 403, not 429/503
    rpc = async () => {
      throw new Error("network");
    };
    expect(await checkControlCode(req(), t, "402815")).toBe(true);
  });
});

describe("client: 429 has its own message", () => {
  const e429 = new ApiError(429, "for_mange_forsok");
  it("pairing screens do not say «feil kode»", () => {
    expect(pairErrorMessage(e429)).toBe("For mange forsøk – vent litt og prøv igjen.");
    expect(pairErrorMessage(e429, true)).toBe("For mange forsøk – vent litt og prøv igjen.");
    expect(pairErrorMessage(new ApiError(404, "finnes_ikke"))).toContain("Fant ingen turnering");
  });
  it("errorMessage maps it too", () => {
    expect(errorMessage(e429)).toBe("For mange forsøk – vent litt og prøv igjen.");
  });
});
