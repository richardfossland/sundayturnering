import { afterEach, describe, expect, it, vi } from "vitest";

import { boundedFetch } from "@/lib/supabase/service";

afterEach(() => vi.unstubAllGlobals());

describe("service client fetch", () => {
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
