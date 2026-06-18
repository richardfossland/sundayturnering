"use client";

import { useMemo, useState } from "react";
import { useTournament } from "@/lib/client/useTournament";
import { QRCode } from "@/lib/client/QRCode";
import { no } from "@/lib/locale/no";
import {
  teamMap,
  liveMatches,
  upcoming,
} from "@/lib/client/view";
import { NowPlaying } from "./NowPlaying";
import { Champion } from "./Champion";
import { BoardTimer } from "./BoardTimer";
import { CodesOverlay } from "./CodesOverlay";
import { Commentator } from "./Commentator";
import { BoardControls } from "./BoardControls";
import { BoardStandingsPanel } from "./BoardStandingsPanel";
import { useReactionWall } from "./ReactionWall";
import { events } from "@/lib/realtime";
import { playDing } from "@/lib/client/sound";
import type { Match } from "@/lib/types";

export function BoardClient({
  id,
  spectator = false,
}: {
  id: string;
  spectator?: boolean;
}) {
  const [flash, setFlash] = useState(false);
  const [wallRef, wall] = useReactionWall();
  const { state, error } = useTournament(id, 15_000, (event, payload) => {
    // Celebrate a freshly entered result: chime + a brief, subtle border flash.
    if (event === events.matchUpdated) {
      playDing();
      setFlash(true);
      setTimeout(() => setFlash(false), 450);
    }
    // Spectator cheer → float emoji on the board (no refetch, see useTournament).
    if (event === events.reaction) wallRef.current?.push(payload);
  });
  const [showCodes, setShowCodes] = useState(false);

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");

  const teams = useMemo(() => teamMap(state?.teams ?? []), [state?.teams]);

  if (error && !state)
    return (
      <main className="center-screen">
        <div className="empty">{no.common.error}</div>
      </main>
    );
  if (!state)
    return (
      <main className="center-screen">
        <span className="spin" />
      </main>
    );

  const { tournament, matches, courts } = state;

  const finished = tournament.status === "finished";

  const live = liveMatches(matches);
  const next = upcoming(matches, 6);
  // The on-screen QR is the READ-ONLY spectator link — anyone in the room can
  // scan it safely. Points at /se/ (phone view + tap-to-cheer); referees join by
  // typing the control code (shown as text).
  const followUrl = `${baseUrl}/se/${tournament.id}`;

  // Commentator stays mounted in a stable tree position across the league →
  // finished transition, so its previous-snapshot ref survives and the
  // "champion crowned" cut-in still plays over the celebration screen.
  return (
    <>
      <Commentator state={state} />
      {finished ? (
        <Champion state={state} />
      ) : (
    <main className={`board${flash ? " board-flash" : ""}`}>
      <BoardControls spectator={spectator} onCodes={() => setShowCodes(true)} />
      {wall}
      {showCodes && !spectator && (
        <CodesOverlay
          tournament={tournament}
          baseUrl={baseUrl}
          onClose={() => setShowCodes(false)}
        />
      )}
      <header className="board-head">
        <div>
          <h1 className="board-title">{tournament.title || no.brand}</h1>
          {tournament.sport_label && (
            <div className="board-sport">{tournament.sport_label}</div>
          )}
          <BoardTimer timer={tournament.timer} />
        </div>
        {spectator ? (
          <div className="board-qr">
            <QRCode value={followUrl} size={104} />
            <div className="board-qr-label">{no.board.follow}</div>
          </div>
        ) : (
          // Full codes live in the CodesOverlay (⚿ in the controls cluster); the
          // header keeps just the scannable follow QR + a compact code chip.
          <button
            className="board-code-chip"
            onClick={() => setShowCodes(true)}
            title={no.board.codesBtn}
          >
            <div className="board-qr">
              <QRCode value={followUrl} size={88} />
              <div className="board-qr-label">{no.board.follow}</div>
            </div>
            <span className="board-code-mini">
              <span className="board-code-mini-label">{no.board.controlCode}</span>
              <span className="board-code-mini-val">{tournament.control_code}</span>
            </span>
          </button>
        )}
      </header>

      <div className="board-body">
        <section className="stack" style={{ minHeight: 0 }}>
          <NowPlaying
            live={live}
            teams={teams}
            courts={courts}
            scoring={tournament.scoring}
            parallel={tournament.parallelism === "parallel"}
          />
          {next.length > 0 && (
            <div className="panel">
              <div className="section-title" style={{ fontSize: "1.1rem" }}>
                {no.board.nextUp}
              </div>
              <div className="next-list">
                {next.map((m) => (
                  <NextRow key={m.id} m={m} teams={teams} courts={courts} />
                ))}
              </div>
            </div>
          )}
        </section>

        <BoardStandingsPanel state={state} teams={teams} />
      </div>
    </main>
      )}
    </>
  );
}

function NextRow({
  m,
  teams,
  courts,
}: {
  m: Match;
  teams: Map<string, import("@/lib/types").Team>;
  courts: import("@/lib/types").Court[];
}) {
  const h = m.home_team_id ? teams.get(m.home_team_id) : null;
  const a = m.away_team_id ? teams.get(m.away_team_id) : null;
  const court = courts.find((c) => c.id === m.court_id);
  return (
    <div className="next-row">
      <span className="team">
        <span className="team-swatch" style={{ background: h?.colour }} />
        <span className="team-name">{h?.name ?? no.board.tbd}</span>
      </span>
      <span className="next-vs">{no.common.vs}</span>
      <span className="team">
        <span className="team-swatch" style={{ background: a?.colour }} />
        <span className="team-name">{a?.name ?? no.board.tbd}</span>
      </span>
      {court && <span className="next-court">{court.name}</span>}
    </div>
  );
}
