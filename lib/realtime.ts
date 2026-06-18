// Realtime channel + event names. Shared by client (subscribe) and server
// (broadcast). Payloads are minimal hints to refetch authoritative state, never
// the source of truth (spec §4 step 4). Event volume is low.

export const channels = {
  // Broadcast channel: board + all control devices subscribe here for refetch
  // hints (match_updated / structure / lock_changed).
  tournament: (tournamentId: string) => `t:${tournamentId}`,
  // Presence lives on its OWN channel — a Supabase channel can't take new
  // callbacks once subscribed, and the broadcast channel is already subscribed,
  // so presence must not share that topic.
  presence: (tournamentId: string) => `t:${tournamentId}:presence`,
};

export const events = {
  matchUpdated: "match_updated", // a result was entered/overridden → refetch
  lockChanged: "lock_changed", // a soft lock was set/cleared on a match
  structure: "structure", // status/bracket/courts changed → refetch all
  // EPHEMERAL spectator cheer. Carries no authoritative state and is NEVER
  // written to the DB — it only theatricalises the board. Receivers must NOT
  // refetch on this event (see useTournament). Payload = ReactionPayload.
  reaction: "reaction",
} as const;

// ---------- spectator reactions (ephemeral broadcast only) ----------

/** The cheers a spectator can tap. Closed set so board + phone stay in sync and
 * a malformed payload can be ignored rather than rendered. */
export const reactionKinds = ["clap", "fire", "goal"] as const;
export type ReactionKind = (typeof reactionKinds)[number];

/** The emoji each cheer floats up as on the board. */
export const reactionEmoji: Record<ReactionKind, string> = {
  clap: "👏",
  fire: "🔥",
  goal: "📣",
};

/** Wire shape of a `reaction` broadcast. `n` lets a client coalesce several
 * taps into one message (rate-limit) instead of spamming the channel. */
export interface ReactionPayload {
  kind: ReactionKind;
  n: number;
}

export function isReactionKind(v: unknown): v is ReactionKind {
  return typeof v === "string" && (reactionKinds as readonly string[]).includes(v);
}

/** Parse an untrusted broadcast payload into a clamped ReactionPayload, or null
 * if it isn't a valid reaction. `n` is clamped to [1, maxN] so one message can
 * never inflate the board counter without bound. */
export function parseReactionPayload(
  payload: Record<string, unknown>,
  maxN = 20,
): ReactionPayload | null {
  if (!isReactionKind(payload.kind)) return null;
  const raw = typeof payload.n === "number" && Number.isFinite(payload.n) ? payload.n : 1;
  const n = Math.max(1, Math.min(maxN, Math.floor(raw)));
  return { kind: payload.kind, n };
}

/** Client-side send throttle. Each tap is buffered; the buffer is flushed as a
 * single broadcast at most once per `windowMs`. Pure + framework-free so it can
 * be unit-tested and reused by the phone view. */
export class ReactionThrottle {
  private buffer: Partial<Record<ReactionKind, number>> = {};
  private lastFlush = 0;

  constructor(
    private windowMs = 400,
    private maxPerWindow = 20,
  ) {}

  /** Record a tap. Returns the payloads to broadcast NOW (empty if buffered). */
  tap(kind: ReactionKind, now = Date.now()): ReactionPayload[] {
    this.buffer[kind] = Math.min(
      this.maxPerWindow,
      (this.buffer[kind] ?? 0) + 1,
    );
    if (now - this.lastFlush >= this.windowMs) return this.flush(now);
    return [];
  }

  /** Force-emit anything buffered (call on a timer / unmount). */
  flush(now = Date.now()): ReactionPayload[] {
    const out: ReactionPayload[] = [];
    for (const k of reactionKinds) {
      const n = this.buffer[k];
      if (n && n > 0) out.push({ kind: k, n });
    }
    this.buffer = {};
    this.lastFlush = now;
    return out;
  }

  get pending(): boolean {
    return reactionKinds.some((k) => (this.buffer[k] ?? 0) > 0);
  }
}

/** Fold an incoming reaction into a running per-kind aggregate count (board's
 * "X cheers" tally). Returns a NEW object so React state updates cleanly. */
export function addReaction(
  counts: Record<ReactionKind, number>,
  p: ReactionPayload,
): Record<ReactionKind, number> {
  return { ...counts, [p.kind]: (counts[p.kind] ?? 0) + p.n };
}

export function emptyReactionCounts(): Record<ReactionKind, number> {
  return { clap: 0, fire: 0, goal: 0 };
}
