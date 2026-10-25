import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { channelConfig } from "@/lib/client/channelRegistry";
import { channels } from "@/lib/realtime";
import { broadcastMessages, LEGACY_PUBLIC_COPY } from "@/lib/server/broadcast";

// The seam between client topics, server sends and migr 0011's policies: the
// topic shapes here must be exactly the ones rt_topic_ok accepts, or private
// subscribes fail with "Unauthorized" in prod while every unit test is green.

const ID = "11111111-2222-4333-8444-555555555555";
const sql = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0011_realtime_private.sql"),
  "utf8",
);
const topicRe = new RegExp(sql.match(/p_topic ~\* '([^']+)'/)![1], "i");

describe("private realtime channels", () => {
  it("every topic shape matches the 0011 policy regex", () => {
    for (const t of [channels.tournament(ID), channels.cheer(ID), channels.presence(ID)]) {
      expect(t).toMatch(topicRe);
    }
  });

  it("cheer and presence carry the suffixes the insert policies allow", () => {
    expect(channels.cheer(ID)).toMatch(/^t:.*:cheer$/);
    expect(channels.presence(ID)).toMatch(/^t:.*:presence$/);
    expect(sql).toContain("like 't:%:cheer'");
    expect(sql).toContain("like 't:%:presence'");
  });

  it("clients subscribe privately", () => {
    expect(channelConfig("k").config.private).toBe(true);
    expect(channelConfig("k").config.presence.key).toBe("k");
  });

  it("server sends the private message first, plus the legacy public copy while on", () => {
    const msgs = broadcastMessages(channels.tournament(ID), "structure", { a: 1 });
    expect(msgs[0]).toEqual({ topic: `t:${ID}`, event: "structure", payload: { a: 1 }, private: true });
    expect(msgs).toHaveLength(LEGACY_PUBLIC_COPY ? 2 : 1);
    if (LEGACY_PUBLIC_COPY) expect(msgs[1].private).toBe(false);
  });
});
