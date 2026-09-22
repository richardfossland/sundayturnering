import { beforeEach, describe, expect, it } from "vitest";
import { myTournaments } from "@/lib/client/myTournaments";
import { identity } from "@/lib/client/identity";

// Minimal in-memory localStorage (the test env is plain node).
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const created = (n: number) => ({
  id: `id-${n}`,
  title: `Cup ${n}`,
  control_code: `12345${n % 10}`,
  board_code: `ORD${n}`,
  organiser_code: `ARR${n}`,
});

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe("myTournaments", () => {
  it("remembers a created tournament and attaches this device to it", () => {
    myTournaments.remember(created(1));
    const t = myTournaments.get("id-1");
    expect(t?.organiser_code).toBe("ARR1");
    expect(t?.createdAt).toMatch(/^\d{4}-/);
    // organiser panel, control page and board read these without typing
    expect(identity.organiserCode("id-1")).toBe("ARR1");
    expect(identity.controlCode("id-1")).toBe("123451");
    expect(identity.boardCode("id-1")).toBe("ORD1");
  });

  it("lists newest first, de-duplicates and caps the list", () => {
    for (let i = 0; i < 25; i++) myTournaments.remember(created(i));
    myTournaments.remember(created(3)); // re-remember moves to the top
    const list = myTournaments.list();
    expect(list).toHaveLength(20);
    expect(list[0].id).toBe("id-3");
    expect(list.filter((t) => t.id === "id-3")).toHaveLength(1);
  });

  it("forget drops the entry and every code for it", () => {
    myTournaments.remember(created(1));
    myTournaments.remember(created(2));
    myTournaments.forget("id-1");
    expect(myTournaments.get("id-1")).toBeNull();
    expect(myTournaments.get("id-2")).not.toBeNull();
    expect(identity.organiserCode("id-1")).toBe("");
    expect(identity.controlCode("id-1")).toBeNull();
    expect(identity.boardCode("id-1")).toBeNull();
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("turnering:mine", "{not json");
    expect(myTournaments.list()).toEqual([]);
    localStorage.setItem("turnering:mine", JSON.stringify([{ id: 1 }, null, created(9)]));
    expect(myTournaments.list().map((t) => t.id)).toEqual(["id-9"]);
  });

  it("never throws when storage is unavailable", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(myTournaments.list()).toEqual([]);
    expect(() => myTournaments.remember(created(1))).not.toThrow();
    expect(() => myTournaments.forget("id-1")).not.toThrow();
  });
});
