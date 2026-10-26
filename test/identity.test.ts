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

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("identity.deviceSecret (C3)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is a stable 128-bit-ish secret, different from the deviceId", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const s = identity.deviceSecret();
    expect(s).toMatch(/^[\w-]{16,128}$/);
    expect(identity.deviceSecret()).toBe(s);
    expect(s).not.toBe(identity.deviceId());
  });

  it("two devices (separate storage) get different secrets", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const a = identity.deviceSecret();
    vi.stubGlobal("localStorage", fakeStorage());
    expect(identity.deviceSecret()).not.toBe(a);
  });

  it("falls back to a per-page-load secret when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    });
    const a = identity.deviceSecret();
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(identity.deviceSecret()).toBe(a);
  });
});

describe("identity.markOwned / ownedResult — «Endre» only for results THIS phone saved", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("remembers the saved version per match", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(identity.ownedResult("m1")).toBeNull();
    identity.markOwned("m1", 3);
    expect(identity.ownedResult("m1")).toEqual({ version: 3 });
    expect(identity.ownedResult("m2")).toBeNull();
  });

  it("a second device has its own (empty) memory", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    identity.markOwned("m1", 3);
    vi.stubGlobal("localStorage", fakeStorage());
    expect(identity.ownedResult("m1")).toBeNull();
  });

  it("forgets old saves", () => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", fakeStorage());
    identity.markOwned("old", 1);
    vi.setSystemTime(Date.now() + 16 * 60_000);
    expect(identity.ownedResult("old")).toBeNull();
    identity.markOwned("new", 1);
    expect(identity.ownedResult("new")).toEqual({ version: 1 });
  });
});
