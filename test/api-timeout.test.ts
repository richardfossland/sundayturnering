import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __setFetchTimeout, api, ApiError } from "@/lib/client/api";
import { Refetcher } from "@/lib/client/refetch";
import { errorMessage } from "@/lib/locale/errors";

/** A fetch that never answers on its own but honours the abort signal. */
function hangingFetch(_url: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
  });
}

beforeEach(() => __setFetchTimeout(30));
afterEach(() => {
  __setFetchTimeout();
  vi.unstubAllGlobals();
});

describe("api timeouts", () => {
  it("a hanging POST rejects with ApiError(0, tidsavbrudd)", async () => {
    vi.stubGlobal("fetch", hangingFetch);
    const err = await api.finish("t", "code").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe("tidsavbrudd");
    expect(errorMessage(err)).toMatch(/svarer ikke/);
  });

  it("a hanging fetchState rejects the same way", async () => {
    vi.stubGlobal("fetch", hangingFetch);
    await expect(api.fetchState("t")).rejects.toMatchObject({ status: 0, code: "tidsavbrudd" });
  });

  it("a stalled BODY (headers arrived) is bounded too, not swallowed as {}", async () => {
    vi.stubGlobal("fetch", (_u: unknown, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_r, rej) =>
            init!.signal!.addEventListener("abort", () => rej(init!.signal!.reason)),
          ),
      } as unknown as Response),
    );
    await expect(api.fetchState("t")).rejects.toMatchObject({ status: 0, code: "tidsavbrudd" });
  });

  it("still maps normal error bodies and lets network TypeErrors through", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "konflikt" }, { status: 409 }));
    await expect(api.finish("t", "c")).rejects.toMatchObject({ status: 409, code: "konflikt" });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(api.finish("t", "c")).rejects.toBeInstanceOf(TypeError);
  });
});

describe("write vs read bounds", () => {
  it("writes get the longer bound, GETs the shorter one", async () => {
    __setFetchTimeout(); // defaults
    vi.stubGlobal("fetch", async () => Response.json({}));
    const spy = vi.spyOn(AbortSignal, "timeout");
    await api.fetchState("t");
    await api.finish("t", "c");
    expect(spy.mock.calls.map((c) => c[0])).toEqual([8000, 15000]);
    spy.mockRestore();
  });
});

describe("Refetcher after a timeout", () => {
  it("frees the in-flight slot so the next request runs", async () => {
    vi.stubGlobal("fetch", hangingFetch);
    let runs = 0;
    const r = new Refetcher(async () => {
      runs++;
      if (runs === 1) await api.fetchState("t"); // times out → rejects
    });
    r.now();
    expect(r.busy).toBe(true);
    await vi.waitFor(() => expect(r.busy).toBe(false));
    r.now();
    await vi.waitFor(() => expect(runs).toBe(2));
  });
});
