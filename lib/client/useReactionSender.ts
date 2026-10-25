"use client";

import { useCallback, useEffect, useState } from "react";
import { acquireChannel, sendOnTopic } from "@/lib/client/channelRegistry";
import { channels, events, ReactionThrottle } from "@/lib/realtime";
import type { ReactionKind } from "@/lib/realtime";

/** Phone-side reaction sender: pushes ephemeral `reaction` broadcasts on the
 * cheer topic (`channels.cheer`) — never a DB write. The hint topic is
 * receive-only for clients (migr 0011), so cheers live on their own topic.
 *
 * Acquires the channel through the registry (one channel per topic,
 * ref-counted), so a remount reuses it instead of racing a second subscribe.
 * Taps are coalesced through a {@link ReactionThrottle} so a
 * spectator mashing a button emits at most one message per window; anything
 * still buffered is flushed on a short timer and on unmount. */
export function useReactionSender(tournamentId: string | null): (kind: ReactionKind) => void {
  const [throttle] = useState(() => new ReactionThrottle());
  const topic = tournamentId ? channels.cheer(tournamentId) : null;

  const send = useCallback(
    (payloads: ReturnType<ReactionThrottle["flush"]>) => {
      if (!topic) return;
      for (const p of payloads) sendOnTopic(topic, events.reaction, { kind: p.kind, n: p.n });
    },
    [topic],
  );

  useEffect(() => {
    if (!topic) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    // Hold a reference so the channel exists even if no listener is mounted.
    const { release } = acquireChannel(topic, {});
    const flushTimer = setInterval(() => {
      if (throttle.pending) send(throttle.flush());
    }, 500);
    return () => {
      clearInterval(flushTimer);
      if (throttle.pending) send(throttle.flush());
      release();
    };
  }, [topic, send, throttle]);

  return useCallback(
    (kind: ReactionKind) => {
      const out = throttle.tap(kind);
      if (out.length > 0) send(out);
    },
    [send, throttle],
  );
}
