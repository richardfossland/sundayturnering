import { describe, it, expect } from "vitest";
import { timeOfDay, withTimeOfDay } from "@/lib/client/templates";

// A saved template keeps times of day and durations, never the start DATE.

describe("template schedule helpers", () => {
  it("extracts the time of day from a local datetime", () => {
    expect(timeOfDay("2026-10-25T09:30")).toBe("09:30");
    expect(timeOfDay("")).toBe("");
  });

  it("applies a saved time of day to the wizard's current date", () => {
    expect(withTimeOfDay("2026-11-02T08:00", "09:30")).toBe("2026-11-02T09:30");
  });

  it("leaves the value alone for a missing or malformed time", () => {
    expect(withTimeOfDay("2026-11-02T08:00", "")).toBe("2026-11-02T08:00");
    expect(withTimeOfDay("2026-11-02T08:00", "9:3")).toBe("2026-11-02T08:00");
  });
});
