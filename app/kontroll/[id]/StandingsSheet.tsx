"use client";

import { Icon } from "@/lib/client/Icon";
import { no } from "@/lib/locale/no";
import { useEscape } from "@/lib/client/useEscape";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { Standings, GroupStandings } from "@/app/board/[id]/Standings";
import type { Team } from "@/lib/types";
import type { StateDTO } from "@/lib/dto";

/** «Tabell» as a bottom sheet over the match list (was an inline strip that
 * pushed the whole list down). Closes with the button, Escape or a tap outside. */
export function StandingsSheet({
  state,
  teams,
  showDraw,
  onClose,
}: {
  state: Pick<StateDTO, "standings" | "groupStandings">;
  teams: Map<string, Team>;
  showDraw: boolean;
  onClose: () => void;
}) {
  useEscape(onClose);
  const ref = useFocusTrap<HTMLDivElement>("dialog");
  const { standings, groupStandings } = state;
  return (
    <div className="scrim scrim-sheet" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        className="card sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="standings-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id="standings-sheet-title" className="sheet-title">{no.board.standings}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label={no.control.standingsClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">
          {groupStandings && groupStandings.length > 0 ? (
            <GroupStandings groups={groupStandings} teams={teams} showDraw={showDraw} compact />
          ) : (
            <Standings standings={standings} teams={teams} showDraw={showDraw} compact />
          )}
        </div>
      </div>
    </div>
  );
}
