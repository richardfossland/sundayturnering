import { describe, expect, it } from "vitest";

import { clientIp, rateLimit } from "@/lib/server/http";

const reqWith = (headers: Record<string, string>) =>
  new Request("https://turnering.sundaysuite.app/api/attach", { headers });

describe("clientIp", () => {
  it("prefers the un-spoofable CF-Connecting-IP over X-Forwarded-For", () => {
    const req = reqWith({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
    });
    expect(clientIp(req)).toBe("203.0.113.7");
  });

  it("falls back to the first X-Forwarded-For entry when CF header is absent", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "9.9.9.9, 8.8.8.8" }))).toBe("9.9.9.9");
  });

  it("returns 'local' when no IP headers are present", () => {
    expect(clientIp(reqWith({}))).toBe("local");
  });

  it("a forged X-Forwarded-For cannot mint a fresh bucket once CF-Connecting-IP is set", () => {
    const a = clientIp(reqWith({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "r1" }));
    const b = clientIp(reqWith({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "r2" }));
    expect(a).toBe(b);
  });
});

describe("rateLimit", () => {
  it("allows up to `limit` calls then blocks within the window", () => {
    const key = `t-${Math.random()}`;
    expect(rateLimit(key, 2, 60_000)).toBe(true);
    expect(rateLimit(key, 2, 60_000)).toBe(true);
    expect(rateLimit(key, 2, 60_000)).toBe(false);
  });
});
