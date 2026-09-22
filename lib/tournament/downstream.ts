// Changing who won a knockout match after the next round was played used to
// swap the team in the later match while leaving that match's result, winner
// and status untouched — the champion could end up being a team that never
// reached the final. The pure half of the fix: work out which later matches
// depend on a result, so the server can refuse (referee) or reset them
// (organiser, after a confirm).

import type { BracketLink, Match } from "@/lib/types";

type LinkLike = Pick<BracketLink, "from_match_id" | "to_match_id" | "to_slot">;
type MatchLike = Pick<Match, "id" | "status">;

export interface DownstreamReset {
  /** Later matches already live/done that must go back to 'scheduled'. */
  reset: string[];
  /** Slots whose team came from a match being reset (or from the changed
   * match itself) and so are no longer known. The changed match's own slots
   * are refilled by propagation right after. */
  clearSlots: { matchId: string; slot: "home" | "away" }[];
}

/** Every started match downstream of `fromId`, plus the slots to clear. Only
 * follows past a match that is itself started: an unplayed match hasn't fed
 * anything further yet. */
export function planDownstreamReset(
  fromId: string,
  links: readonly LinkLike[],
  matches: readonly MatchLike[],
): DownstreamReset {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const out: DownstreamReset = { reset: [], clearSlots: [] };
  const seen = new Set<string>();

  const visit = (id: string, isRoot: boolean) => {
    for (const l of links) {
      if (l.from_match_id !== id) continue;
      const target = byId.get(l.to_match_id);
      if (!target) continue;
      // The root's own slots are refilled by propagation; deeper slots were
      // fed by a match we are resetting, so they become unknown.
      if (!isRoot) out.clearSlots.push({ matchId: target.id, slot: l.to_slot });
      const started = target.status === "live" || target.status === "done";
      if (started && !seen.has(target.id)) {
        seen.add(target.id);
        out.reset.push(target.id);
        visit(target.id, false);
      }
    }
  };
  visit(fromId, true);
  return out;
}
