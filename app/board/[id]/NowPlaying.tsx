"use client";

import { no } from "@/lib/locale/no";
import { initials } from "@/lib/client/view";
import { resolve } from "@/lib/tournament/scoring";
import { BoardTimer } from "./BoardTimer";
import type { Court, Match, ScoringConfig, Team } from "@/lib/types";

// "Now playing": one big card (sequential) or a per-court grid (parallel).

export function NowPlaying({
  live,
  teams,
  courts,
  scoring,
  parallel,
}: {
  live: Match[];
  teams: Map<string, Team>;
  courts: Court[];
  scoring: ScoringConfig;
  parallel: boolean;
}) {
  if (live.length === 0)
    return (
      <div className="now-card">
        <div className="now-label">
          <span className="dot" />
          {no.board.nowPlaying}
        </div>
        <div className="empty" style={{ padding: "28px 10px" }}>
          {no.board.lobby}
        </div>
      </div>
    );

  if (parallel && courts.length > 0) {
    return (
      <div className="now-card">
        <div className="now-label">
          <span className="dot" />
          {no.board.nowPlaying}
        </div>
        <div className="court-grid">
          {courts.map((c) => {
            const m = live.find((lm) => lm.court_id === c.id);
            return (
              <div className="court-card" key={c.id}>
                <div className="court-head">
                  <span className="court-name">{c.name}</span>
                  <BoardTimer timer={c.timer} compact />
                </div>
                {m ? (
                  <Versus m={m} teams={teams} scoring={scoring} compact />
                ) : (
                  <div className="faint">—</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // sequential → biggest match
  return (
    <div className="now-card">
      <div className="now-label">
        <span className="dot" />
        {no.board.nowPlaying}
      </div>
      <Versus m={live[0]} teams={teams} scoring={scoring} />
    </div>
  );
}

function Versus({
  m,
  teams,
  scoring,
  compact,
}: {
  m: Match;
  teams: Map<string, Team>;
  scoring: ScoringConfig;
  compact?: boolean;
}) {
  const h = m.home_team_id ? teams.get(m.home_team_id) : null;
  const a = m.away_team_id ? teams.get(m.away_team_id) : null;
  const r = m.result ? resolve(scoring.profile, m.result) : null;

  return (
    <div className="versus">
      <Side team={h} score={r?.homeScore} compact={compact} />
      <span className="versus-mid">{no.common.vs}</span>
      <Side team={a} score={r?.awayScore} compact={compact} right />
    </div>
  );
}

function Side({
  team,
  score,
  compact,
}: {
  team: Team | null | undefined;
  score: number | undefined;
  compact?: boolean;
  right?: boolean;
}) {
  if (compact)
    return (
      <div className="team" style={{ flexDirection: "column", gap: 6 }}>
        <span className="versus-name" style={{ fontSize: "1rem" }}>
          {team?.name ?? no.board.tbd}
        </span>
        {score != null && <span className="versus-score" style={{ fontSize: "1.6rem" }}>{score}</span>}
      </div>
    );
  return (
    <div className="versus-team">
      {team?.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="versus-logo" src={team.logo_url} alt="" />
      ) : (
        <span className="versus-badge" style={{ background: team?.colour ?? "#444" }}>
          {team ? initials(team.name) : "?"}
        </span>
      )}
      <span className="versus-name">{team?.name ?? no.board.tbd}</span>
      {score != null && <span className="versus-score">{score}</span>}
      {team && team.members.length > 0 && (
        <span className="versus-roster">{team.members.join(" · ")}</span>
      )}
    </div>
  );
}
