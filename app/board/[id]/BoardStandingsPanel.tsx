"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { no } from "@/lib/locale/no";
import { BoardStandings, planStandings } from "./BoardStandings";
import { Bracket, bracketLabels } from "./Bracket";
import { swissProgress } from "@/lib/tournament/swiss";
import { byBracketOrder } from "@/lib/tournament/bracketLayout";
import type { StateDTO } from "@/lib/dto";
import type { BracketId, Team } from "@/lib/types";

/** Dobbel utslag og cup har ingen tabell (ingen serie å rangere): braketten får hele kolonnen. */
export function hasStandingsTable(format: string): boolean {
  return format !== "double_elim" && format !== "cup";
}

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
  // the cut line is always kept (see capRows in BoardStandings.tsx).
  const standingsLimit = hasBracket ? 8 : undefined;
  const plan = useMemo(
    () => planStandings(standings, groupStandings, standingsLimit),
    [standings, groupStandings, standingsLimit],
  );

  const swiss =
    tournament.format === "swiss"
      ? swissProgress(matches, tournament.config?.swiss?.rounds ?? 0)
      : null;

  const noTable = !hasStandingsTable(tournament.format);

  return (
    <section
      className={`board-right${hasBracket && !noTable ? " has-bracket" : ""}${noTable ? " no-table" : ""}`}
      style={{ minHeight: 0, ["--lines" as string]: plan.lines }}
    >
      {!noTable && (
        <div className="card board-standings-region">
          <div className="board-region-title">
            {no.board.standings}
            {swiss && <span className="board-region-sub">{no.board.swissRound(swiss.round, swiss.total)}</span>}
          </div>
          <BoardStandings plan={plan} teams={teams} showDraw={showDraw} />
        </div>
      )}

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

  // A og B får sjelden plass samtidig: vis én om gangen med faner, og bytt av seg
  // selv (~20 s) til noen trykker eller scroller.
  const ids = useMemo(
    () =>
      [...new Set(matches.filter((m) => m.phase === "playoff").map((m) => m.bracket ?? "A"))]
        .sort(byBracketOrder) as BracketId[],
    [matches],
  );
  const labels = bracketLabels(tournament.config?.consolation);
  const [picked, setPicked] = useState<BracketId>("A");
  const active = ids.includes(picked) ? picked : ids[0];
  useEffect(() => {
    if (paused || ids.length < 2) return;
    const t = setInterval(
      () => setPicked((p) => ids[(Math.max(0, ids.indexOf(p)) + 1) % ids.length]),
      20_000,
    );
    return () => clearInterval(t);
  }, [paused, ids]);

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
    <div className="card board-bracket-region">
      <div className="board-region-title">
        {no.board.bracket}
        {ids.length > 1 && (
          <div className="board-seg" role="tablist">
            {ids.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === active}
                data-on={id === active}
                onClick={() => {
                  setPaused(true);
                  setPicked(id);
                }}
              >
                {labels[id] ?? id}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        className="board-bracket-scroll"
        onPointerDown={() => setPaused(true)}
      >
        <Bracket
          matches={matches}
          teams={teams}
          scoring={tournament.scoring}
          links={state.links}
          consolation={tournament.config?.consolation}
          only={ids.length > 1 ? active : undefined}
          scrollRef={scrollRef}
          fit
        />
      </div>
    </div>
  );
}
