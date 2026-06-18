"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import {
  addReaction,
  emptyReactionCounts,
  parseReactionPayload,
  reactionEmoji,
  reactionKinds,
} from "@/lib/realtime";
import type { ReactionKind } from "@/lib/realtime";

// Floating-emoji overlay for the board. Driven entirely by ephemeral `reaction`
// broadcasts forwarded from useTournament — no DB, no authoritative state. The
// imperative handle lets BoardClient push a reaction in without re-rendering the
// whole board on every cheer.

export interface ReactionWallHandle {
  push: (payload: Record<string, unknown>) => void;
}

interface Floater {
  id: number;
  emoji: string;
  left: number; // vw-ish offset 0..100
  drift: number; // horizontal drift in px
  dur: number; // seconds
}

let seq = 0;
const MAX_FLOATERS = 60; // hard cap so a flood can't pile up DOM nodes

export function useReactionWall(): [
  React.RefObject<ReactionWallHandle | null>,
  React.ReactElement,
] {
  const ref = useRef<ReactionWallHandle>(null);
  return [ref, <ReactionWall key="rw" handleRef={ref} />];
}

function ReactionWall({
  handleRef,
}: {
  handleRef: React.RefObject<ReactionWallHandle | null>;
}) {
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [counts, addCount] = useReducer(
    (
      state: Record<ReactionKind, number>,
      p: { kind: ReactionKind; n: number },
    ) => addReaction(state, p),
    null,
    emptyReactionCounts,
  );

  useEffect(() => {
    handleRef.current = {
      push(raw) {
        const p = parseReactionPayload(raw);
        if (!p) return;
        addCount(p);
        const emoji = reactionEmoji[p.kind];
        // Spawn a few floaters (capped) — one per coalesced tap, max 8 visuals
        // per message so a big `n` doesn't choke the board.
        const visuals = Math.min(p.n, 8);
        const born: Floater[] = Array.from({ length: visuals }, () => ({
          id: seq++,
          emoji,
          left: 4 + Math.random() * 92,
          drift: (Math.random() - 0.5) * 80,
          dur: 2.6 + Math.random() * 1.4,
        }));
        setFloaters((prev) => [...prev, ...born].slice(-MAX_FLOATERS));
        // Reap after the longest animation so the list can't grow unbounded.
        const maxDur = Math.max(...born.map((b) => b.dur)) * 1000 + 200;
        const ids = new Set(born.map((b) => b.id));
        setTimeout(
          () => setFloaters((prev) => prev.filter((f) => !ids.has(f.id))),
          maxDur,
        );
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  const total = reactionKinds.reduce((s, k) => s + counts[k], 0);

  return (
    <div className="reaction-wall" aria-hidden="true">
      {floaters.map((f) => (
        <span
          key={f.id}
          className="reaction-floater"
          style={
            {
              left: `${f.left}%`,
              "--drift": `${f.drift}px`,
              "--dur": `${f.dur}s`,
            } as React.CSSProperties
          }
        >
          {f.emoji}
        </span>
      ))}
      {total > 0 && (
        <div className="reaction-tally">
          {reactionKinds
            .filter((k) => counts[k] > 0)
            .map((k) => (
              <span className="reaction-tally-item" key={k}>
                <span className="reaction-tally-emoji">{reactionEmoji[k]}</span>
                <span className="reaction-tally-count">{counts[k]}</span>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
