import { describe, it, expect } from "vitest";
import { addBounded } from "@/lib/client/boundedSet";

describe("addBounded", () => {
  it("drops the oldest entries past the cap", () => {
    const s = new Set<string>();
    for (let i = 0; i < 520; i++) addBounded(s, `k${i}`, 500);
    expect(s.size).toBe(500);
    expect(s.has("k0")).toBe(false);
    expect(s.has("k19")).toBe(false);
    expect(s.has("k20")).toBe(true);
    expect(s.has("k519")).toBe(true);
  });
  it("keeps everything under the cap", () => {
    const s = new Set<number>();
    addBounded(s, 1, 3);
    addBounded(s, 2, 3);
    expect([...s]).toEqual([1, 2]);
  });
});
