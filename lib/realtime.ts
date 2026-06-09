// Realtime channel + event names. Shared by client (subscribe) and server
// (broadcast). Payloads are minimal hints to refetch authoritative state, never
// the source of truth (spec §4 step 4). Event volume is low.

export const channels = {
  // One channel per tournament carries everything: board + all control devices
  // attach here. Presence on this channel tracks attached control devices.
  tournament: (tournamentId: string) => `t:${tournamentId}`,
};

export const events = {
  matchUpdated: "match_updated", // a result was entered/overridden → refetch
  lockChanged: "lock_changed", // a soft lock was set/cleared on a match
  structure: "structure", // status/bracket/courts changed → refetch all
} as const;
