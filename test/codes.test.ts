import { describe, it, expect } from "vitest";
import {
  generateControlCode,
  generateWordCode,
  normalizeWordCode,
  isValidControlCode,
  generateUnique,
} from "@/lib/codes";

// deterministic RNG
function seq(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("control code", () => {
  it("is 6 digits", () => {
    for (let i = 0; i < 50; i++)
      expect(generateControlCode()).toMatch(/^\d{6}$/);
  });
  it("validates format", () => {
    expect(isValidControlCode("402815")).toBe(true);
    expect(isValidControlCode(" 402815 ")).toBe(true);
    expect(isValidControlCode("40281")).toBe(false);
    expect(isValidControlCode("abcdef")).toBe(false);
  });
});

describe("word code", () => {
  it("is 4+2 letters, no ambiguous chars, no digits", () => {
    for (let i = 0; i < 50; i++) {
      const c = generateWordCode();
      expect(c).toMatch(/^[A-Z]{4}-[A-Z]{2}$/);
      expect(c).not.toMatch(/[IO]/);
    }
  });
  it("normalises typed input", () => {
    expect(normalizeWordCode("kolefr")).toBe("KOLE-FR");
    expect(normalizeWordCode("kole fr")).toBe("KOLE-FR");
    expect(normalizeWordCode("KOLE-FR")).toBe("KOLE-FR");
  });
});

describe("generateUnique", () => {
  it("retries until it finds an unused code", () => {
    const rng = seq([0, 0, 0.5]); // first two collide, third is fresh
    const taken = new Set(["AAAA-AA"]);
    const code = generateUnique(generateWordCode, taken, rng);
    expect(taken.has(code)).toBe(false);
  });
  it("throws if it cannot find one", () => {
    expect(() =>
      generateUnique(() => "X", new Set(["X"]), Math.random, 5),
    ).toThrow();
  });
});
