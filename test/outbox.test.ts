import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, vi } from "vitest";
import { ApiError } from "@/lib/client/api";
import {
  Outbox,
  backoffMs,
  classifySendError,
  indexedDbStore,
  localStorageStore,
  memoryStore,
  type OutboxEntry,
  type OutboxEvent,
  type OutboxStore,
} from "@/lib/client/outbox";
import type { Match } from "@/lib/types";

// The referee outbox: a result typed with no network is queued on the phone and
// sent exactly once when the net is back (the server de-duplicates by requestId,
// see migration 0015).

const entryInput = (n: number) => ({
  requestId: `00000000-0000-4000-8000-00000000000${n}`,
  tournamentId: "t1",
  matchId: `m${n}`,
  expectedVersion: 0,
  payload: { result: { home: n, away: 0 }, deviceId: "d1", controlCode: "402815" },
});
const match = { id: "m1", status: "done" } as unknown as Match;

/** Outbox with manual timers so backoff can be asserted without waiting. */
function make(store: OutboxStore, send: (e: OutboxEntry) => Promise<Match | null>) {
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const outbox = new Outbox({
    store,
    send,
    now: (() => {
      let t = 1000;
      return () => t++;
    })(),
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { live: boolean }).live = false;
    },
  });
  const events: OutboxEvent[] = [];
  outbox.on((e) => events.push(e));
  const pending = () => timers.filter((t) => t.live);
  return { outbox, events, timers, pending };
}

const net = () => new TypeError("Failed to fetch");

describe("backoff policy", () => {
  it("doubles from 1 s and caps at 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });

  it("keeps network errors, timeouts, 5xx and 429; drops the rest of 4xx", () => {
    expect(classifySendError(net())).toBe("keep");
    expect(classifySendError(new ApiError(0, "tidsavbrudd"))).toBe("keep");
    expect(classifySendError(new ApiError(502, "x"))).toBe("keep");
    expect(classifySendError(new ApiError(500, "kunne_ikke_lagre"))).toBe("keep");
    expect(classifySendError(new ApiError(429, "for_mange_forsok"))).toBe("keep");
    expect(classifySendError(new ApiError(409, "konflikt"))).toBe("drop");
    expect(classifySendError(new ApiError(422, "ugyldig_resultat"))).toBe("drop");
    expect(classifySendError(new ApiError(403, "feil_kontrollkode"))).toBe("drop");
  });
});

describe("Outbox", () => {
  it("2xx removes the entry and reports it sent", async () => {
    const store = memoryStore();
    const send = vi.fn(async () => match);
    const { outbox, events } = make(store, send);
    await outbox.ready();
    await outbox.enqueue(entryInput(1));
    expect(outbox.snapshot()).toHaveLength(1);
    await outbox.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(outbox.snapshot()).toHaveLength(0);
    expect(await store.all()).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(["sent"]);
  });

  it("network failure keeps the entry, counts the attempt and schedules a backoff retry", async () => {
    const store = memoryStore();
    const send = vi.fn(async () => {
      throw net();
    });
    const { outbox, events, pending } = make(store, send);
    await outbox.ready();
    await outbox.enqueue(entryInput(1));
    await outbox.flush();
    const [e] = outbox.snapshot();
    expect(e.attempts).toBe(1);
    expect(e.lastError).toBe("nett");
    expect((await store.all())[0].attempts).toBe(1);
    expect(events).toEqual([]);
    expect(pending().at(-1)?.ms).toBe(1000);
    await outbox.flush();
    expect(outbox.snapshot()[0].attempts).toBe(2);
    expect(pending().at(-1)?.ms).toBe(2000);
  });

  it("5xx keeps the entry; once the net is back it is sent and removed", async () => {
    const store = memoryStore();
    let up = false;
    const send = vi.fn(async () => {
      if (!up) throw new ApiError(503, "midlertidig_feil");
      return match;
    });
    const { outbox } = make(store, send);
    await outbox.ready();
    await outbox.enqueue(entryInput(1));
    await outbox.flush();
    expect(outbox.snapshot()).toHaveLength(1);
    up = true;
    await outbox.flush();
    expect(outbox.snapshot()).toHaveLength(0);
  });

  it("409 konflikt removes the entry and surfaces it as rejected", async () => {
    const store = memoryStore();
    const send = vi.fn(async () => {
      throw new ApiError(409, "konflikt");
    });
    const { outbox, events } = make(store, send);
    await outbox.ready();
    await outbox.enqueue(entryInput(1));
    await outbox.flush();
    expect(outbox.snapshot()).toHaveLength(0);
    expect(await store.all()).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("rejected");
    expect(events[0].type === "rejected" && events[0].error.code).toBe("konflikt");
    expect(send).toHaveBeenCalledTimes(1); // never retried
  });

  it("a rejected entry does not block the ones behind it", async () => {
    const sent: string[] = [];
    const send = vi.fn(async (e: OutboxEntry) => {
      if (e.matchId === "m1") throw new ApiError(422, "ugyldig_resultat");
      sent.push(e.matchId);
      return match;
    });
    const { outbox } = make(memoryStore(), send);
    await outbox.ready();
    await outbox.enqueue(entryInput(1));
    await outbox.enqueue(entryInput(2));
    await outbox.flush();
    expect(sent).toEqual(["m2"]);
    expect(outbox.snapshot()).toHaveLength(0);
  });

  it("a network failure stops the pass (order kept, later entries untouched)", async () => {
    const seen: string[] = [];
    const send = vi.fn(async (e: OutboxEntry) => {
      seen.push(e.matchId);
      throw net();
    });
    const { outbox } = make(memoryStore(), send);
    await outbox.ready();
    await outbox.enqueue(entryInput(1));
    await outbox.enqueue(entryInput(2));
    await outbox.flush();
    expect(seen).toEqual(["m1"]);
    expect(outbox.snapshot().map((e) => e.attempts)).toEqual([1, 0]);
  });

  it("never flushes in parallel: concurrent calls share one pass, one send", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const send = vi.fn(async () => {
      await gate;
      return match;
    });
    const { outbox } = make(memoryStore(), send);
    await outbox.ready();
    await outbox.enqueue(entryInput(1));
    const a = outbox.flush();
    const b = outbox.flush();
    expect(b).toBe(a);
    await Promise.resolve();
    release();
    await Promise.all([a, b]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("the scheduled retry fires a flush", async () => {
    let up = false;
    const send = vi.fn(async () => {
      if (!up) throw net();
      return match;
    });
    const { outbox, pending } = make(memoryStore(), send);
    await outbox.ready();
    await outbox.enqueue(entryInput(1));
    await outbox.flush();
    up = true;
    pending().at(-1)!.fn();
    await outbox.flush(); // joins the running pass
    expect(outbox.snapshot()).toHaveLength(0);
  });
});

describe("persistence across re-instantiation (reload)", () => {
  async function reload(store: OutboxStore) {
    const send = vi.fn(async (e: OutboxEntry) => (void e, match));
    const second = make(store, send);
    await second.outbox.ready();
    return { ...second, send };
  }

  it("IndexedDB: queued entry survives a new Outbox and is then sent once", async () => {
    const factory = new IDBFactory();
    const first = make(indexedDbStore(factory), async () => {
      throw net();
    });
    await first.outbox.ready();
    await first.outbox.enqueue(entryInput(1));
    await first.outbox.flush();

    const { outbox, send } = await reload(indexedDbStore(factory));
    expect(outbox.snapshot()).toHaveLength(1);
    expect(outbox.snapshot()[0]).toMatchObject({ requestId: entryInput(1).requestId, attempts: 1 });
    await outbox.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].requestId).toBe(entryInput(1).requestId); // same id → server dedupes
    const { outbox: third } = await reload(indexedDbStore(factory));
    expect(third.snapshot()).toHaveLength(0);
  });

  it("localStorage fallback: survives a new Outbox", async () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    } as unknown as Storage;
    const first = make(localStorageStore(storage), async () => {
      throw net();
    });
    await first.outbox.ready();
    await first.outbox.enqueue(entryInput(1));
    const { outbox } = await reload(localStorageStore(storage));
    expect(outbox.snapshot().map((e) => e.matchId)).toEqual(["m1"]);
    await outbox.flush();
    expect(outbox.snapshot()).toHaveLength(0);
  });

  it("a store that throws never breaks queueing (memory copy still sends)", async () => {
    const broken: OutboxStore = {
      all: async () => {
        throw new Error("blocked");
      },
      put: async () => {
        throw new Error("blocked");
      },
      remove: async () => {
        throw new Error("blocked");
      },
    };
    const send = vi.fn(async () => match);
    const { outbox } = make(broken, send);
    await outbox.ready();
    await outbox.enqueue(entryInput(1));
    expect(outbox.snapshot()).toHaveLength(1);
    await outbox.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(outbox.snapshot()).toHaveLength(0);
  });
});
