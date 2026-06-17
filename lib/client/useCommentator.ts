"use client";

import { useEffect, useRef, useState } from "react";
import { diffSnapshots, type Storyline } from "@/lib/tournament/narrate";
import type { StateDTO } from "@/lib/dto";

/**
 * Turns the stream of tournament snapshots into a live commentator feed.
 *
 * Pure diffing lives in lib/tournament/narrate.ts (fully unit-tested). This
 * hook only does the *stateful* glue the diff can't: remember the previous
 * snapshot, de-duplicate already-seen storylines by key, and expose:
 *   - `cutin`  — the highest-priority full-screen card to show right now
 *   - `ticker` — the rolling list of recent ticker-worthy beats
 *
 * It NEVER touches authoritative state; it only reads the StateDTO the board
 * already has. No network, no key.
 */
export function useCommentator(state: StateDTO | null, opts?: { maxTicker?: number }) {
  const maxTicker = opts?.maxTicker ?? 8;
  const prev = useRef<StateDTO | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const [ticker, setTicker] = useState<Storyline[]>([]);
  const [queue, setQueue] = useState<Storyline[]>([]);
  const [cutin, setCutin] = useState<Storyline | null>(null);

  useEffect(() => {
    if (!state) return;
    const lines = diffSnapshots(prev.current, state);
    prev.current = state;
    if (lines.length === 0) return;

    const fresh = lines.filter((l) => !seen.current.has(l.key));
    if (fresh.length === 0) return;
    for (const l of fresh) seen.current.add(l.key);

    setTicker((t) => [...fresh, ...t].slice(0, maxTicker));
    const cutins = fresh.filter((l) => l.display === "cutin");
    if (cutins.length > 0) setQueue((q) => [...q, ...cutins]);
  }, [state, maxTicker]);

  // Drain the cut-in queue one card at a time.
  useEffect(() => {
    if (cutin || queue.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pop next cut-in
    setCutin(queue[0]);
    setQueue((q) => q.slice(1));
  }, [cutin, queue]);

  function dismissCutin() {
    setCutin(null);
  }

  return { ticker, cutin, dismissCutin };
}
