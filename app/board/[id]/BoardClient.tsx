"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTournament } from "@/lib/client/useTournament";
import { QRCode } from "@/lib/client/QRCode";
import { no } from "@/lib/locale/no";
import {
  teamMap,
  liveMatches,
  upcoming,
} from "@/lib/client/view";
import { Standings } from "./Standings";
import { Bracket } from "./Bracket";
import { NowPlaying } from "./NowPlaying";
import { Champion } from "./Champion";
import { BoardTimer } from "./BoardTimer";
import { CodesOverlay } from "./CodesOverlay";
import { Commentator } from "./Commentator";
import { useReactionWall } from "./ReactionWall";
import { SoundToggle } from "@/lib/client/SoundToggle";
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
    // Celebrate a freshly entered result: chime + a brief board pulse.
    if (event === events.matchUpdated) {
      playDing();
      setFlash(true);
      setTimeout(() => setFlash(false), 700);
    }
    // Spectator cheer → float emoji on the board (no refetch, see useTournament).
    if (event === events.reaction) wallRef.current?.push(payload);
  });
  // Right panel: auto-rotates standings↔bracket, but the user can take manual
  // control (pauses the rotation) via the on-board view switcher.
  const [panel, setPanel] = useState<"standings" | "bracket">("standings");
  const [manual, setManual] = useState(false);
  const [showCodes, setShowCodes] = useState(false);

  const hasBracket = !!state?.matches.some((m) => m.phase === "playoff");
  const hasLeague = state?.tournament.format !== "cup";

  useEffect(() => {
    if (!hasBracket || !hasLeague || manual) return;
    const t = setInterval(
      () => setPanel((p) => (p === "standings" ? "bracket" : "standings")),
      9000,
    );
    return () => clearInterval(t);
  }, [hasBracket, hasLeague, manual]);

  function pick(p: "standings" | "bracket") {
    setManual(true);
    setPanel(p);
  }

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

  const { tournament, matches, standings, courts } = state;

  const finished = tournament.status === "finished";

  const live = liveMatches(matches);
  const next = upcoming(matches, 6);
  // The on-screen QR is the READ-ONLY spectator link — anyone in the room can
  // scan it safely. Points at /se/ (phone view + tap-to-cheer); referees join by
  // typing the control code (shown as text).
  const followUrl = `${baseUrl}/se/${tournament.id}`;

  // which right-hand panel
  const canSwitch = hasBracket && hasLeague;
  const showBracket = canSwitch
    ? panel === "bracket"
    : hasBracket && (!hasLeague || tournament.status === "playoff");

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
      <SoundToggle />
      {wall}
      {!spectator && (
        <>
          <Link className="board-home" href="/" aria-label="Hjem" title="Hjem">
            ⌂
          </Link>
          <button
            className="board-home board-codes-fab"
            onClick={() => setShowCodes(true)}
            aria-label={no.board.codesBtn}
            title={no.board.codesBtn}
          >
            ⚿
          </button>
        </>
      )}
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
          <div className="row" style={{ alignItems: "center", gap: 18 }}>
            <div className="board-qr">
              <QRCode value={followUrl} size={104} />
              <div className="board-qr-label">{no.board.follow}</div>
            </div>
          </div>
        ) : (
          <button
            className="row board-codes-open"
            style={{ alignItems: "center", gap: 18 }}
            onClick={() => setShowCodes(true)}
            title={no.board.codesBtn}
          >
            <div className="board-code-card">
              <div className="board-code-label">{no.board.controlCode}</div>
              <div className="board-code">{tournament.control_code}</div>
            </div>
            <div className="board-qr">
              <QRCode value={followUrl} size={104} />
              <div className="board-qr-label">{no.board.follow}</div>
            </div>
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

        <section className="card card-pad" style={{ minHeight: 0, overflow: "auto" }}>
          <div className="spread" style={{ marginBottom: 4 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>
              {showBracket ? no.board.bracket : no.board.standings}
            </div>
            {canSwitch && (
              <div className="board-views">
                <button data-on={!showBracket} onClick={() => pick("standings")}>
                  {no.board.standings}
                </button>
                <button data-on={showBracket} onClick={() => pick("bracket")}>
                  {no.board.bracket}
                </button>
                {manual && (
                  <button onClick={() => setManual(false)} title="Auto-veksling">
                    ⟳
                  </button>
                )}
              </div>
            )}
          </div>
          {showBracket ? (
            <Bracket matches={matches} teams={teams} scoring={tournament.scoring} />
          ) : (
            <Standings
              standings={standings}
              teams={teams}
              showDraw={tournament.scoring.profile === "simple" && tournament.scoring.allowDraw}
            />
          )}
        </section>
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
