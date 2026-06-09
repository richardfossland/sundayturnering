"use client";

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
import type { Match } from "@/lib/types";

export function BoardClient({ id }: { id: string }) {
  const { state, error } = useTournament(id);
  // auto-rotate between standings and bracket when both exist
  const [panel, setPanel] = useState<"standings" | "bracket">("standings");

  const hasBracket = !!state?.matches.some((m) => m.phase === "playoff");
  const hasLeague = state?.tournament.format !== "cup";

  useEffect(() => {
    if (!hasBracket || !hasLeague) return;
    const t = setInterval(
      () => setPanel((p) => (p === "standings" ? "bracket" : "standings")),
      9000,
    );
    return () => clearInterval(t);
  }, [hasBracket, hasLeague]);

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

  if (tournament.status === "finished")
    return <Champion state={state} />;

  const live = liveMatches(matches);
  const next = upcoming(matches, 6);
  const joinUrl = `${baseUrl}/kontroll?code=${tournament.control_code}`;

  // which right-hand panel
  const showBracket =
    hasBracket && (!hasLeague || panel === "bracket" || tournament.status === "playoff");

  return (
    <main className="board">
      <header className="board-head">
        <div>
          <h1 className="board-title">{tournament.title || no.brand}</h1>
          {tournament.sport_label && (
            <div className="board-sport">{tournament.sport_label}</div>
          )}
        </div>
        <div className="row" style={{ alignItems: "center", gap: 18 }}>
          <div className="board-code-card">
            <div className="board-code-label">{no.board.controlCode}</div>
            <div className="board-code">{tournament.control_code}</div>
          </div>
          <QRCode value={joinUrl} size={104} />
        </div>
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
          {showBracket ? (
            <>
              <div className="section-title">{no.board.bracket}</div>
              <Bracket matches={matches} teams={teams} scoring={tournament.scoring} />
            </>
          ) : (
            <>
              <div className="section-title">{no.board.standings}</div>
              <Standings
                standings={standings}
                teams={teams}
                showDraw={tournament.scoring.profile === "simple" && tournament.scoring.allowDraw}
              />
            </>
          )}
        </section>
      </div>
    </main>
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
