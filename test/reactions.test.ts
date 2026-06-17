import { describe, it, expect } from "vitest";
import {
  ReactionThrottle,
  addReaction,
  emptyReactionCounts,
  isReactionKind,
  parseReactionPayload,
  reactionEmoji,
  reactionKinds,
} from "@/lib/realtime";

describe("isReactionKind", () => {
  it("accepts the closed set", () => {
    for (const k of reactionKinds) expect(isReactionKind(k)).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isReactionKind("boo")).toBe(false);
    expect(isReactionKind(3)).toBe(false);
    expect(isReactionKind(null)).toBe(false);
  });
  it("every kind has an emoji", () => {
    for (const k of reactionKinds) expect(reactionEmoji[k]).toBeTruthy();
  });
});

describe("parseReactionPayload", () => {
  it("parses a valid payload", () => {
    expect(parseReactionPayload({ kind: "clap", n: 3 })).toEqual({
      kind: "clap",
      n: 3,
    });
  });
  it("defaults missing/invalid n to 1", () => {
    expect(parseReactionPayload({ kind: "fire" })?.n).toBe(1);
    expect(parseReactionPayload({ kind: "fire", n: "x" })?.n).toBe(1);
    expect(parseReactionPayload({ kind: "fire", n: NaN })?.n).toBe(1);
  });
  it("clamps n to [1, maxN] and floors it", () => {
    expect(parseReactionPayload({ kind: "goal", n: 0 })?.n).toBe(1);
    expect(parseReactionPayload({ kind: "goal", n: -5 })?.n).toBe(1);
    expect(parseReactionPayload({ kind: "goal", n: 9999 })?.n).toBe(20);
    expect(parseReactionPayload({ kind: "goal", n: 3.9 })?.n).toBe(3);
    expect(parseReactionPayload({ kind: "goal", n: 50 }, 5)?.n).toBe(5);
  });
  it("returns null for an unknown/malformed kind", () => {
    expect(parseReactionPayload({ kind: "lol", n: 1 })).toBeNull();
    expect(parseReactionPayload({})).toBeNull();
  });
});

describe("addReaction", () => {
  it("accumulates per kind immutably", () => {
    const a = emptyReactionCounts();
    const b = addReaction(a, { kind: "clap", n: 2 });
    expect(a.clap).toBe(0); // original untouched
    expect(b.clap).toBe(2);
    const c = addReaction(b, { kind: "clap", n: 3 });
    expect(c.clap).toBe(5);
    expect(c.fire).toBe(0);
  });
});

describe("ReactionThrottle", () => {
  it("emits the first tap immediately, then buffers within the window", () => {
    const t = new ReactionThrottle(400, 20);
    expect(t.tap("clap", 1000)).toEqual([{ kind: "clap", n: 1 }]);
    // within window → buffered, nothing emitted
    expect(t.tap("clap", 1100)).toEqual([]);
    expect(t.tap("fire", 1200)).toEqual([]);
    expect(t.pending).toBe(true);
  });

  it("coalesces buffered taps into one message per kind on the next window", () => {
    const t = new ReactionThrottle(400, 20);
    t.tap("clap", 1000); // emits immediately, resets lastFlush=1000
    t.tap("clap", 1100); // buffer clap=1
    t.tap("clap", 1200); // buffer clap=2
    t.tap("fire", 1250); // buffer fire=1
    // window elapsed → flush buffered as coalesced payloads
    const out = t.tap("clap", 1500);
    expect(out).toContainEqual({ kind: "clap", n: 3 }); // 2 buffered + this tap
    expect(out).toContainEqual({ kind: "fire", n: 1 });
    expect(t.pending).toBe(false);
  });

  it("clamps a buffered burst to maxPerWindow", () => {
    const t = new ReactionThrottle(400, 5);
    t.tap("goal", 0); // immediate
    for (let i = 1; i <= 50; i++) t.tap("goal", 10 + i); // all buffered, same window
    const out = t.flush(20);
    expect(out).toEqual([{ kind: "goal", n: 5 }]);
  });

  it("flush() empties the buffer and is idempotent when empty", () => {
    const t = new ReactionThrottle();
    t.tap("clap", 0); // first window not yet elapsed → buffered (clap=1)
    t.tap("clap", 10); // buffered (clap=2)
    expect(t.flush(20)).toEqual([{ kind: "clap", n: 2 }]);
    expect(t.flush(30)).toEqual([]);
    expect(t.pending).toBe(false);
  });
});
