"use client";

import { useEffect, useRef, useState } from "react";
import { no } from "@/lib/locale/no";
import { Standings, GroupStandings } from "./Standings";
import { Bracket } from "./Bracket";
import type { StateDTO } from "@/lib/dto";
import type { Team } from "@/lib/types";

/**
 * The board's right column. Standings are ALWAYS visible (top region) — they no
 * longer rotate away every 9s. When a playoff bracket exists it lives below in
 * its own region. Replaces the old standings↔bracket auto-flip: nothing the
 * spectator needs ever leaves the screen.
 */
export function BoardStandingsPanel({
  state,
  teams,
}: {
  state: StateDTO;
  teams: Map<string, Team>;
}) {
  const { tournament, matches, standings, groupStandings } = state;
  const hasBracket = matches.some((m) => m.phase === "playoff");
  const showDraw =
    tournament.scoring.profile === "simple" && tournament.scoring.allowDraw;

  // League-only → standings own the whole right column (no row cap). With a
  // bracket sharing the column, cap rows so the panel never needs to scroll;
  // the cut line is always kept (see capRows in Standings.tsx).
  const standingsLimit = hasBracket ? 8 : undefined;

  return (
    <section className="board-right" style={{ minHeight: 0 }}>
      <div className="card card-pad board-standings-region">
        <div className="section-title" style={{ marginBottom: 8 }}>
          {no.board.standings}
        </div>
        <div className="board-standings-scroll">
          {groupStandings && groupStandings.length > 0 ? (
            <GroupStandings
              groups={groupStandings}
              teams={teams}
              showDraw={showDraw}
              limit={standingsLimit}
              compact
            />
          ) : (
            <Standings
              standings={standings}
              teams={teams}
              showDraw={showDraw}
              limit={standingsLimit}
              compact
            />
          )}
        </div>
      </div>

      {hasBracket && <BracketRegion state={state} teams={teams} />}
    </section>
  );
}

/**
 * Bracket region beneath the always-on standings. A gentle ~15s auto-cycle pans
 * the bracket horizontally so later rounds come into view on a wide board,
 * unless the spectator scrolls/taps it (which pauses the pan). This is the only
 * remaining auto-motion in the right column — the slowed "manual switcher for
 * bracket detail" the brief asks for, in place of the old 9s panel flip.
 */
function BracketRegion({
  state,
  teams,
}: {
  state: StateDTO;
  teams: Map<string, Team>;
}) {
  const { matches, tournament } = state;
  const roundCount = new Set(
    matches.filter((m) => m.phase === "playoff").map((m) => m.round),
  ).size;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  // Gently pan the bracket end↔start every ~15s so later rounds come into view
  // on a wide board without ever hiding the standings above. Any interaction
  // pauses it. This is the only remaining auto-motion (replaces the 9s flip).
  useEffect(() => {
    if (paused || roundCount < 2) return;
    const el = scrollRef.current;
    if (!el) return;
    let atEnd = false;
    const t = setInterval(() => {
      if (el.scrollWidth - el.clientWidth < 24) return; // nothing to reveal
      atEnd = !atEnd;
      el.scrollTo({ left: atEnd ? el.scrollWidth : 0, behavior: "smooth" });
    }, 15_000);
    return () => clearInterval(t);
  }, [paused, roundCount]);

  return (
    <div className="card card-pad board-bracket-region">
      <div className="spread" style={{ marginBottom: 8 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          {no.board.bracket}
        </div>
      </div>
      <div
        ref={scrollRef}
        className="board-bracket-scroll"
        onPointerDown={() => setPaused(true)}
      >
        <Bracket
          matches={matches}
          teams={teams}
          scoring={tournament.scoring}
        />
      </div>
    </div>
  );
}
