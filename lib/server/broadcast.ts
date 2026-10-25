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
//
// Messages go out `private: true` (clients subscribe to private channels, migr
// 0011). service_role bypasses Realtime RLS, so the server may send anywhere.

/** TRANSITION (remove in the follow-up PR): also send a PUBLIC copy so boards /
 * phones still running the previous bundle (public channels) keep getting live
 * hints until they reload. Public and private channels on one topic are
 * separate, so the copy never reaches the new private subscribers twice. */
export const LEGACY_PUBLIC_COPY = true;

/** The REST `messages` body for one broadcast: the private message, plus the
 * public legacy copy while {@link LEGACY_PUBLIC_COPY} is on. */
export function broadcastMessages(
  topic: string,
  event: string,
  payload: Record<string, unknown>,
): Array<{ topic: string; event: string; payload: Record<string, unknown>; private: boolean }> {
  const msgs = [{ topic, event, payload, private: true }];
  if (LEGACY_PUBLIC_COPY) msgs.push({ topic, event, payload, private: false });
  return msgs;
}

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
      body: JSON.stringify({ messages: broadcastMessages(topic, event, payload) }),
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

/** Push an EPHEMERAL spectator reaction onto the cheer channel. Reactions
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
    channels.cheer(tournamentId),
    events.reaction,
    payload as unknown as Record<string, unknown>,
  );
}
