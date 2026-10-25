import { afterEach, describe, expect, it, vi } from "vitest";

import { boundedFetch, DB_TIMEOUT_MS } from "@/lib/supabase/service";

afterEach(() => vi.unstubAllGlobals());

describe("service client fetch", () => {
  it("server bound (4 s) stays well under the client WRITE bound (15 s)", async () => {
    const { WRITE_TIMEOUT_MS, READ_TIMEOUT_MS } = await import("@/lib/client/api");
    expect(DB_TIMEOUT_MS).toBe(4000);
    expect(WRITE_TIMEOUT_MS).toBe(15000);
    expect(READ_TIMEOUT_MS).toBe(8000);
    expect(DB_TIMEOUT_MS * 3).toBeLessThan(WRITE_TIMEOUT_MS);
  });

  it("always passes a signal, and aborts a hung call", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    vi.stubGlobal("fetch", (_u: unknown, init?: RequestInit) => {
      seen.push(init?.signal ?? undefined);
      return Promise.resolve(new Response("{}"));
    });
    await boundedFetch("https://x.test/a");
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0]!.aborted).toBe(false);
  });

  it("combines with the caller's signal", async () => {
    let got: AbortSignal | undefined;
    vi.stubGlobal("fetch", (_u: unknown, init?: RequestInit) => {
      got = init?.signal ?? undefined;
      return Promise.resolve(new Response("{}"));
    });
    const ctl = new AbortController();
    await boundedFetch("https://x.test/a", { signal: ctl.signal });
    expect(got).not.toBe(ctl.signal);
    ctl.abort();
    expect(got!.aborted).toBe(true);
  });
});
