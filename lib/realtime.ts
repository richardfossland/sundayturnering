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
} as const;
