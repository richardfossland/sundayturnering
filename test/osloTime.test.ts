import { describe, expect, it } from "vitest";
import {
  isoToOsloLocal,
  nextOsloHourLocal,
  osloLocalToIso,
} from "@/lib/tournament/osloTime";

// Faste forventninger: hjelperne bruker aldri vertens tidssone.
describe("osloLocalToIso", () => {
  it("sommertid (+02:00)", () => {
    expect(osloLocalToIso("2026-07-01T12:00")).toBe("2026-07-01T10:00:00.000Z");
  });
  it("vintertid (+01:00)", () => {
    expect(osloLocalToIso("2026-01-15T12:00")).toBe("2026-01-15T11:00:00.000Z");
  });
  it("vårskiftet 2026-03-29: før og etter hullet", () => {
    expect(osloLocalToIso("2026-03-29T01:59")).toBe("2026-03-29T00:59:00.000Z");
    expect(osloLocalToIso("2026-03-29T03:00")).toBe("2026-03-29T01:00:00.000Z");
    expect(osloLocalToIso("2026-03-29T12:00")).toBe("2026-03-29T10:00:00.000Z");
  });
  it("vår-hullet (02:30 finnes ikke) skyves til 03:30", () => {
    expect(osloLocalToIso("2026-03-29T02:30")).toBe("2026-03-29T01:30:00.000Z");
  });
  it("høstskiftet 2026-10-25: overlapp gir første forekomst", () => {
    expect(osloLocalToIso("2026-10-25T01:59")).toBe("2026-10-24T23:59:00.000Z");
    expect(osloLocalToIso("2026-10-25T02:30")).toBe("2026-10-25T00:30:00.000Z");
    expect(osloLocalToIso("2026-10-25T03:00")).toBe("2026-10-25T02:00:00.000Z");
    expect(osloLocalToIso("2026-10-25T12:00")).toBe("2026-10-25T11:00:00.000Z");
  });
  it("ugyldig input gir tom streng", () => {
    expect(osloLocalToIso("")).toBe("");
    expect(osloLocalToIso("i morgen")).toBe("");
  });
});

describe("isoToOsloLocal", () => {
  it("viser Oslo-veggklokke", () => {
    expect(isoToOsloLocal("2026-07-01T10:00:00.000Z")).toBe("2026-07-01T12:00");
    expect(isoToOsloLocal("2026-01-15T11:00:00.000Z")).toBe("2026-01-15T12:00");
    expect(isoToOsloLocal("2026-10-25T00:30:00.000Z")).toBe("2026-10-25T02:30");
    expect(isoToOsloLocal("2026-10-25T01:30:00.000Z")).toBe("2026-10-25T02:30");
    expect(isoToOsloLocal("nope")).toBe("");
  });
  it("rundtur utenom hull/overlapp", () => {
    for (const l of [
      "2026-01-15T12:00",
      "2026-03-29T03:00",
      "2026-07-01T23:45",
      "2026-10-25T03:00",
      "2026-12-31T00:00",
    ]) {
      expect(isoToOsloLocal(osloLocalToIso(l))).toBe(l);
    }
  });
});

describe("nextOsloHourLocal", () => {
  it("neste hele time i Oslo-tid", () => {
    expect(nextOsloHourLocal(new Date("2026-07-01T10:20:00Z"))).toBe("2026-07-01T13:00");
    expect(nextOsloHourLocal(new Date("2026-01-15T22:59:59Z"))).toBe("2026-01-16T00:00");
    expect(nextOsloHourLocal(new Date("2026-07-01T10:00:00Z"))).toBe("2026-07-01T13:00");
  });
});
