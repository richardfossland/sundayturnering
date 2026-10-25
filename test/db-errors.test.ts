import { describe, it, expect, vi, beforeEach } from "vitest";

// A Supabase outage must read as a failure (503 midlertidig_feil), never as
// "not found" (404) or an empty tournament (200) — the projector replaces its
// good state with whatever a 200 carries.

const ID = "11111111-1111-1111-1111-111111111111";

// Every chained call returns the same proxy; awaiting it yields a DB error.
function failingClient() {
  const result = { data: null, error: { message: "connection reset" } };
  const p: unknown = new Proxy(() => p, {
    get: (_t, k) => (k === "then" ? (res: (v: unknown) => void) => res(result) : p),
    apply: () => p,
  });
  return p;
}
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => failingClient() }));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: async () => {} }));
vi.mock("@/lib/server/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/auth")>()),
  authOrganiserOrAdmin: async () => ({ id: ID }),
}));

import { GET } from "@/app/api/tournament/[id]/route";
import { POST as finish } from "@/app/api/organiser/finish/route";
import { must, withApi, __resetRateLimiter } from "@/lib/server/http";

beforeEach(() => {
  __resetRateLimiter();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("DB errors", () => {
  it("GET /api/tournament/[id] → 503, not 404 or an empty state", async () => {
    const res = await GET(new Request("http://localhost/api/tournament/x"), {
      params: Promise.resolve({ id: ID }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "midlertidig_feil" });
  });

  it("a write route (organiser/finish) → 503 when the update fails", async () => {
    const res = await finish(
      new Request("http://localhost/api/organiser/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tournamentId: ID, organiserCode: "ABCD-EF" }),
      }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("midlertidig_feil");
  });
});

describe("must / withApi", () => {
  it("must returns data and throws the error", () => {
    expect(must({ data: [1], error: null })).toEqual([1]);
    expect(must({ error: null })).toBeUndefined();
    const err = { message: "boom" };
    expect(() => must({ data: null, error: err })).toThrow();
  });

  it("withApi passes responses through and maps throws to JSON 503", async () => {
    const okRes = await withApi(() => Response.json({ a: 1 }))();
    expect(okRes.status).toBe(200);
    const bad = await withApi(async () => {
      throw new Error("x");
    })();
    expect(bad.status).toBe(503);
    expect(bad.headers.get("content-type")).toMatch(/json/);
  });
});
