"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { Match, MatchResult } from "@/lib/types";

// Referee outbox (A5 «Dommertelefon uten nett»). A result that cannot reach the
// server (no/flaky network, timeout, 5xx) is queued on the phone and re-sent
// until it gets an answer. Every entry carries a requestId: the server stores
// the outcome per id (migration 0015), so a send whose reply was lost and is
// then repeated commits exactly once and never 409s against itself.
//
//   2xx                → remove
//   network / timeout / 5xx / 429 → keep, back off, retry. Order is kept per
//                      match only: a stuck entry never blocks other matches.
//                      After MAX_ATTEMPTS the entry is marked `failed`: it is
//                      no longer sent, stays visible (the referee re-enters
//                      the score or tells the organiser) until dismissed.
//   409 konflikt, other 4xx → remove and report (the match was changed by
//                      someone else, or the entry can never succeed)
//
// The queue survives reload: IndexedDB, falling back to localStorage, falling
// back to memory (private mode) — every storage touch is wrapped in try/catch.

export type OutboxPayload = {
  result: MatchResult;
  deviceId: string;
  deviceName?: string;
  /** Private per-device secret (identity.deviceSecret) for «Endre» ownership. */
  deviceSecret?: string;
  controlCode: string;
};

export type OutboxEntry = {
  requestId: string;
  tournamentId: string;
  matchId: string;
  payload: OutboxPayload;
  expectedVersion: number;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** Gave up after MAX_ATTEMPTS: kept for the UI, never sent again. */
  failed?: boolean;
};

export type OutboxEvent =
  | { type: "sent"; entry: OutboxEntry; match: Match | null; propagated: boolean }
  | { type: "rejected"; entry: OutboxEntry; error: ApiError };

/** Where the queue lives. All methods may reject; the Outbox swallows that. */
export interface OutboxStore {
  all(): Promise<OutboxEntry[]>;
  put(e: OutboxEntry): Promise<void>;
  remove(requestId: string): Promise<void>;
}

// ---- retry policy (pure, unit-tested) --------------------------------------

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_CAP_MS = 30_000;
export const MAX_ATTEMPTS = 8;

/** Delay before attempt number `attempts + 1` (attempts = failed sends so far). */
export function backoffMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

/** keep = try again later; drop = it can never succeed as sent → tell the user. */
export function classifySendError(e: unknown): "keep" | "drop" {
  if (e instanceof ApiError) {
    if (e.status === 0) return "keep"; // client-side timeout (tidsavbrudd)
    if (e.status >= 500 || e.status === 429) return "keep";
    return "drop"; // 409 konflikt, 403 stale code, 422 …
  }
  return "keep"; // fetch() rejected: network down, DNS, offline
}

/** Failures worth queueing for (same rule as classifySendError → keep). */
export function isNetworkFailure(e: unknown): boolean {
  return classifySendError(e) === "keep";
}

// ---- stores ---------------------------------------------------------------

export function memoryStore(): OutboxStore {
  const m = new Map<string, OutboxEntry>();
  return {
    all: async () => [...m.values()],
    put: async (e) => void m.set(e.requestId, e),
    remove: async (id) => void m.delete(id),
  };
}

const LS_KEY = "turnering:outbox";

export function localStorageStore(storage: Storage): OutboxStore {
  const read = (): OutboxEntry[] => {
    try {
      const v = JSON.parse(storage.getItem(LS_KEY) ?? "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const write = (list: OutboxEntry[]) => storage.setItem(LS_KEY, JSON.stringify(list));
  return {
    all: async () => read(),
    put: async (e) => write([...read().filter((x) => x.requestId !== e.requestId), e]),
    remove: async (id) => write(read().filter((x) => x.requestId !== id)),
  };
}

const IDB_NAME = "turnering-outbox";
const IDB_STORE = "entries";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export function indexedDbStore(factory: IDBFactory): OutboxStore {
  let opened: Promise<IDBDatabase> | null = null;
  const open = () =>
    (opened ??= new Promise<IDBDatabase>((res, rej) => {
      const r = factory.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE, { keyPath: "requestId" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error("idb blocked"));
    }));
  const store = async (mode: IDBTransactionMode) =>
    (await open()).transaction(IDB_STORE, mode).objectStore(IDB_STORE);
  return {
    all: async () => (await req((await store("readonly")).getAll())) as OutboxEntry[],
    put: async (e) => void (await req((await store("readwrite")).put(e))),
    remove: async (id) => void (await req((await store("readwrite")).delete(id))),
  };
}

/** Best store this browser offers. IndexedDB can exist yet fail to open
 * (Firefox private mode, blocked site data) → probe it, then fall back. */
export async function openBestStore(): Promise<OutboxStore> {
  try {
    if (typeof indexedDB !== "undefined") {
      const s = indexedDbStore(indexedDB);
      await s.all();
      return s;
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.getItem(LS_KEY);
      return localStorageStore(localStorage);
    }
  } catch {
    /* fall through */
  }
  return memoryStore();
}

// ---- the queue ------------------------------------------------------------

export type OutboxDeps = {
  store: OutboxStore;
  /** One send attempt. Resolves with the saved match, throws on any failure. */
  send: (e: OutboxEntry) => Promise<Match | null | { match: Match | null; propagated: boolean }>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
};

export class Outbox {
  private entries: OutboxEntry[] = [];
  private listeners = new Set<() => void>();
  private handlers = new Set<(e: OutboxEvent) => void>();
  private flushing: Promise<void> | null = null;
  private timer: unknown = null;
  private loaded: Promise<void>;
  private now: () => number;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (h: unknown) => void;

  constructor(private deps: OutboxDeps) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.loaded = deps.store
      .all()
      .then((list) => {
        // Entries enqueued before the load finished stay (they were put()).
        const have = new Set(this.entries.map((x) => x.requestId));
        this.entries = [...list.filter((x) => !have.has(x.requestId)), ...this.entries].sort(
          (a, b) => a.createdAt - b.createdAt,
        );
        this.emit();
      })
      .catch(() => {});
  }

  /** Resolves once the persisted queue has been read. */
  ready(): Promise<void> {
    return this.loaded;
  }

  // useSyncExternalStore contract: stable reference until something changes.
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = (): readonly OutboxEntry[] => this.entries;

  on(fn: (e: OutboxEvent) => void): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }
  private fire(e: OutboxEvent) {
    for (const h of this.handlers) h(e);
  }

  /** Persist a new entry and try to send soon. */
  async enqueue(
    input: Pick<OutboxEntry, "requestId" | "tournamentId" | "matchId" | "payload" | "expectedVersion"> &
      Partial<Pick<OutboxEntry, "attempts" | "lastError">>,
  ): Promise<OutboxEntry> {
    const entry: OutboxEntry = {
      attempts: 0,
      lastError: null,
      ...input,
      createdAt: this.now(),
    };
    await this.discardFailed(entry.matchId);
    this.entries = [...this.entries.filter((x) => x.requestId !== entry.requestId), entry];
    this.emit();
    try {
      await this.deps.store.put(entry);
    } catch {
      /* kept in memory for this page load at least */
    }
    this.schedule(entry.attempts > 0 ? backoffMs(entry.attempts) : 0);
    return entry;
  }

  /** Send everything, oldest first. One flush at a time: a second call while
   * one runs returns the running one (no parallel double-send). */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.cancelTimer();
    this.flushing = this.run().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async run(): Promise<void> {
    await this.loaded;
    let retryIn = 0;
    // Ordering only matters within one match: after a transient failure its
    // later entries wait, other matches carry on.
    const blocked = new Set<string>();
    for (const entry of [...this.entries].sort((a, b) => a.createdAt - b.createdAt)) {
      // Removed or replaced while an earlier entry was in flight.
      if (!this.entries.some((x) => x.requestId === entry.requestId)) continue;
      if (entry.failed || blocked.has(entry.matchId)) continue;
      try {
        const sent = await this.deps.send(entry);
        // `send` may answer a bare match (older seams/tests) or match + flag.
        const { match, propagated } =
          sent && typeof sent === "object" && "propagated" in sent
            ? (sent as { match: Match | null; propagated: boolean })
            : { match: sent as Match | null, propagated: true };
        await this.drop(entry);
        this.fire({ type: "sent", entry, match, propagated });
      } catch (e) {
        if (classifySendError(e) === "drop") {
          await this.drop(entry);
          this.fire({
            type: "rejected",
            entry,
            error: e instanceof ApiError ? e : new ApiError(0, "feil"),
          });
          continue;
        }
        blocked.add(entry.matchId);
        const attempts = entry.attempts + 1;
        const next: OutboxEntry = {
          ...entry,
          attempts,
          lastError: e instanceof ApiError ? e.code : "nett",
          ...(attempts >= MAX_ATTEMPTS ? { failed: true } : {}),
        };
        this.entries = this.entries.map((x) => (x.requestId === next.requestId ? next : x));
        this.emit();
        try {
          await this.deps.store.put(next);
        } catch {
          /* memory copy is still correct */
        }
        if (!next.failed) {
          const d = backoffMs(attempts);
          retryIn = retryIn === 0 ? d : Math.min(retryIn, d);
        }
      }
    }
    if (retryIn > 0) this.schedule(retryIn);
  }

  /** Remove an entry the referee has given up on (or re-entered). */
  async dismiss(requestId: string): Promise<void> {
    const entry = this.entries.find((x) => x.requestId === requestId);
    if (entry) await this.drop(entry);
  }

  /** Drop the failed entries of one match (a new send for it succeeded/queued). */
  async discardFailed(matchId: string): Promise<void> {
    for (const e of this.entries.filter((x) => x.failed && x.matchId === matchId)) await this.drop(e);
  }

  private async drop(entry: OutboxEntry) {
    this.entries = this.entries.filter((x) => x.requestId !== entry.requestId);
    this.emit();
    try {
      await this.deps.store.remove(entry.requestId);
    } catch {
      /* worst case it is re-sent once and the server answers the replay */
    }
  }

  private cancelTimer() {
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule(ms: number) {
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  /** Flush on app start, `online` and tab-visible. Returns the detach function. */
  start(): () => void {
    if (typeof window === "undefined") return () => {};
    const kick = () => void this.flush();
    const onVisible = () => {
      if (document.visibilityState === "visible") kick();
    };
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", onVisible);
    kick();
    return () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", onVisible);
      this.cancelTimer();
    };
  }
}

// ---- browser singleton + React glue ----------------------------------------

function sendEntry(e: OutboxEntry): Promise<{ match: Match | null; propagated: boolean }> {
  return api
    .submitResult(
      e.matchId,
      e.expectedVersion,
      e.payload.result,
      {
        deviceId: e.payload.deviceId,
        deviceName: e.payload.deviceName,
        deviceSecret: e.payload.deviceSecret,
      },
      e.payload.controlCode,
      e.requestId,
    )
    .then((r) => ({ match: r.match ?? null, propagated: r.propagated !== false }));
}

let shared: Outbox | null = null;
export function getOutbox(): Outbox {
  return (shared ??= new Outbox({
    // The store opens asynchronously; until then the queue is read lazily.
    store: lazyStore(),
    send: sendEntry,
  }));
}

function lazyStore(): OutboxStore {
  const s = openBestStore();
  return {
    all: async () => (await s).all(),
    put: async (e) => (await s).put(e),
    remove: async (id) => (await s).remove(id),
  };
}

/** Test seam: forget the singleton. */
export function __resetOutbox(): void {
  shared = null;
}

export function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Old WebView without randomUUID: RFC 4122 v4 from Math.random is fine for
    // an idempotency key (collisions only matter within one tournament).
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

/** Submit a referee result. Tries the network once; if that fails for a
 * network reason the result is queued (same requestId) and `queued` is true.
 * Anything the server actually answered (409, 422 …) is thrown to the caller. */
export async function submitResultOrQueue(
  args: {
    tournamentId: string;
    matchId: string;
    expectedVersion: number;
    result: MatchResult;
    device: { deviceId: string; deviceName?: string; deviceSecret?: string };
    controlCode: string;
  },
  outbox: Outbox = getOutbox(),
): Promise<{ queued: false; match: Match; propagated: boolean } | { queued: true }> {
  const requestId = newRequestId();
  try {
    const r = await api.submitResult(
      args.matchId,
      args.expectedVersion,
      args.result,
      args.device,
      args.controlCode,
      requestId,
    );
    await outbox.discardFailed(args.matchId);
    return { queued: false, match: r.match, propagated: r.propagated !== false };
  } catch (e) {
    if (!isNetworkFailure(e)) throw e;
    await outbox.enqueue({
      requestId,
      tournamentId: args.tournamentId,
      matchId: args.matchId,
      expectedVersion: args.expectedVersion,
      payload: {
        result: args.result,
        deviceId: args.device.deviceId,
        deviceName: args.device.deviceName,
        deviceSecret: args.device.deviceSecret,
        controlCode: args.controlCode,
      },
      attempts: 1,
      lastError: e instanceof ApiError ? e.code : "nett",
    });
    return { queued: true };
  }
}

const EMPTY: readonly OutboxEntry[] = [];

/** Live queue for one tournament; also starts the flush triggers while mounted. */
export function useOutbox(tournamentId: string, onEvent?: (e: OutboxEvent) => void) {
  const outbox = typeof window === "undefined" ? null : getOutbox();
  const all = useSyncExternalStore(
    outbox ? outbox.subscribe : () => () => {},
    outbox ? outbox.snapshot : () => EMPTY,
    () => EMPTY,
  );
  useEffect(() => {
    if (!outbox) return;
    const stop = outbox.start();
    return stop;
  }, [outbox]);
  useEffect(() => {
    if (!outbox || !onEvent) return;
    return outbox.on(onEvent);
  }, [outbox, onEvent]);
  const entries = all.filter((e) => e.tournamentId === tournamentId);
  return {
    entries,
    flush: () => void outbox?.flush(),
    dismiss: (requestId: string) => void outbox?.dismiss(requestId),
  };
}
