"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useChannel } from "@/lib/client/useChannel";
import { useTabHidden } from "@/lib/client/useTabHidden";
import { Refetcher } from "@/lib/client/refetch";
import { sameJson } from "@/lib/client/equal";
import { channels, events } from "@/lib/realtime";
import type { StateDTO } from "@/lib/dto";

export interface UseTournamentOptions {
  /** Poll backstop while the tab is visible. */
  pollMs?: number;
  /** Slower poll while hidden — never skipped, so a dead channel still heals. */
  hiddenPollMs?: number;
  /** Spread broadcast-triggered refetches over 0..jitter ms. Spectator pages
   * set this so 100 phones do not hit the API in the same 50 ms. */
  jitterMs?: number;
  onEvent?: (event: string, payload: Record<string, unknown>) => void;
}

/** Fetch the full tournament state and keep it fresh: refetch on any realtime
 * hint (broadcasts are hints, not data — spec §4.4), on channel trouble, on
 * tab focus / network return, and on a slow poll as the final backstop.
 *
 * Refetches are coalesced (lib/client/refetch.ts): never two in flight, and a
 * hint that arrives mid-fetch runs one more fetch afterwards instead of being
 * dropped — two results 200 ms apart used to leave the board on the first one
 * until the next poll. */
export function useTournament(id: string, opts: UseTournamentOptions = {}) {
  const { pollMs = 15_000, hiddenPollMs = 45_000, jitterMs = 0, onEvent } = opts;
  const [state, setState] = useState<StateDTO | null>(null);
  const [error, setError] = useState(false);
  /** Consecutive failed fetches (reset on success) — drives a reconnect badge. */
  const [failures, setFailures] = useState(0);
  const refetcher = useRef<Refetcher | null>(null);

  // One Refetcher per mount (NOT memoised across StrictMode's double-invoke:
  // a disposed instance must never be reused).
  useEffect(() => {
    const r = new Refetcher(
      async () => {
        try {
          const s = await api.fetchState(id);
          // Keep the previous object when nothing changed → no re-render churn.
          setState((prev) => (sameJson(prev, s) ? prev : s));
          setError(false);
          setFailures(0);
        } catch {
          // Keep the previous state: a failed poll must not blank a live board.
          setError(true);
          setFailures((n) => n + 1);
        }
      },
      { jitterMs },
    );
    refetcher.current = r;
    r.now();
    return () => {
      r.dispose();
      if (refetcher.current === r) refetcher.current = null;
    };
  }, [id, jitterMs]);

  /** Immediate refetch (mount, user action, resync). */
  const refetch = useCallback(() => refetcher.current?.now(), []);
  /** Hint-driven refetch (jittered, coalesced). */
  const hint = useCallback(() => refetcher.current?.request(), []);

  // Realtime hint → refetch authoritative state (+ notify caller, e.g. sounds).
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  useChannel(
    id ? channels.tournament(id) : null,
    (event, payload) => {
      // Reactions are ephemeral theatre with no authoritative state — refetching
      // on every cheer would hammer the API. Forward to the caller (board uses
      // it to float emoji) but skip the refetch.
      if (event !== events.reaction) hint();
      onEventRef.current?.(event, payload);
    },
    (status) => {
      // Broadcasts may have been lost while the channel was down; the registry
      // recreates the channel itself, this catches up on state right away.
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") hint();
    },
  );

  // Resync when the tab regains focus / the network comes back (a phone that
  // slept in a pocket, a projector tab switched back to).
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === "visible") refetch();
    };
    window.addEventListener("focus", resync);
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      window.removeEventListener("focus", resync);
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [refetch]);

  // Poll backstop (covers a missed broadcast / reconnect). Slower, not
  // skipped, while hidden.
  const hidden = useTabHidden();
  useEffect(() => {
    const t = setInterval(hint, hidden ? hiddenPollMs : pollMs);
    return () => clearInterval(t);
  }, [hint, pollMs, hiddenPollMs, hidden]);

  return { state, error, failures, refetch, setState };
}
