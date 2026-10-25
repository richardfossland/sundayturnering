import { describe, it, expect, vi, afterEach } from "vitest";
import { identity } from "@/lib/client/identity";

describe("identity.deviceId with blocked storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a stable random id, never the literal 'anon'", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    });
    const a = identity.deviceId();
    expect(a).not.toBe("anon");
    expect(a.length).toBeGreaterThan(8);
    expect(identity.deviceId()).toBe(a);
  });
});
