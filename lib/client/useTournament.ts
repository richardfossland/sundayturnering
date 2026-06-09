"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useChannel } from "@/lib/client/useChannel";
import { channels } from "@/lib/realtime";
import type { StateDTO } from "@/lib/dto";

/** Fetch the full tournament state and keep it fresh: refetch on any realtime
 * event (broadcasts are hints, not data — spec §4.4) and on a slow poll as a
 * reconnect backstop. */
export function useTournament(id: string, pollMs = 15_000) {
  const [state, setState] = useState<StateDTO | null>(null);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);

  const refetch = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const s = await api.fetchState(id);
      setState(s);
      setError(false);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    refetch();
  }, [refetch]);

  // Realtime hint → refetch authoritative state.
  useChannel(id ? channels.tournament(id) : null, () => {
    refetch();
  });

  // Poll backstop (covers a missed broadcast / reconnect).
  useEffect(() => {
    const t = setInterval(refetch, pollMs);
    return () => clearInterval(t);
  }, [refetch, pollMs]);

  return { state, error, refetch, setState };
}
