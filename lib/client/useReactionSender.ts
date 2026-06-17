"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { channels, events, ReactionThrottle } from "@/lib/realtime";
import type { ReactionKind } from "@/lib/realtime";
import type { RealtimeChannel } from "@supabase/supabase-js";

/** Phone-side reaction sender. Opens a broadcast-only handle on the EXISTING
 * tournament channel and pushes ephemeral `reaction` events — never a DB write.
 *
 * Taps are coalesced through a {@link ReactionThrottle} so a spectator mashing
 * a button emits at most one message per window (client-side rate limit, spec
 * §4: broadcasts are cheap hints). Anything still buffered is flushed on a
 * short timer and on unmount so the final taps aren't lost. */
export function useReactionSender(tournamentId: string | null): (kind: ReactionKind) => void {
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Stable throttle instance for the component's lifetime (lazy init).
  const [throttle] = useState(() => new ReactionThrottle());

  const send = useCallback((payloads: ReturnType<ReactionThrottle["flush"]>) => {
    const channel = channelRef.current;
    if (!channel || payloads.length === 0) return;
    for (const p of payloads) {
      channel.send({
        type: "broadcast",
        event: events.reaction,
        payload: { kind: p.kind, n: p.n },
      });
    }
  }, []);

  useEffect(() => {
    if (!tournamentId) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const supabase = createClient();
    const channel = supabase.channel(channels.tournament(tournamentId), {
      config: { broadcast: { self: false } },
    });
    channel.subscribe();
    channelRef.current = channel;

    // Flush leftover buffered taps so the tail of a burst still lands.
    const flushTimer = setInterval(() => {
      if (throttle.pending) send(throttle.flush());
    }, 500);

    return () => {
      clearInterval(flushTimer);
      if (throttle.pending) send(throttle.flush());
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [tournamentId, send, throttle]);

  return useCallback(
    (kind: ReactionKind) => {
      const out = throttle.tap(kind);
      if (out.length > 0) send(out);
    },
    [send, throttle],
  );
}
