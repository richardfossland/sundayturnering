import "server-only";

import { channels, events } from "@/lib/realtime";
import type { ReactionKind, ReactionPayload } from "@/lib/realtime";

// Server-side Supabase Realtime broadcast via the REST endpoint — lets a
// stateless Route Handler push an event to a channel without opening a
// websocket. Clients subscribed to `topic` receive it.
//
// Failures are swallowed (logged): realtime is a hint layer; if a broadcast is
// lost, clients still recover by refetching authoritative state on their next
// action or reconnect.

export async function broadcast(
  topic: string,
  event: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  // Bound the call so a hung Supabase realtime endpoint can't stall the route
  // handler that awaits this before responding (the referee's "save" would spin
  // forever). Broadcast is a hint layer, so an abort is swallowed like any other
  // failure — clients recover on their next refetch.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ topic, event, payload }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[broadcast] failed", topic, event, res.status);
    }
  } catch (err) {
    console.warn("[broadcast] error", topic, event, err);
  } finally {
    clearTimeout(timeout);
  }
}

/** Push an EPHEMERAL spectator reaction onto the tournament channel. Reactions
 * are normally sent client-side (no server round-trip), but exposing the typed
 * server emitter keeps the `reaction` event a first-class part of the broadcast
 * surface and lets a future server-driven cheer (e.g. an auto goal-horn on a
 * winning result) reuse the exact same wire shape. NEVER writes to the DB and
 * never touches the authoritative result path. */
export function broadcastReaction(
  tournamentId: string,
  kind: ReactionKind,
  n = 1,
): Promise<void> {
  const payload: ReactionPayload = { kind, n };
  return broadcast(
    channels.tournament(tournamentId),
    events.reaction,
    payload as unknown as Record<string, unknown>,
  );
}
