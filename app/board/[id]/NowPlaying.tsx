"use client";

import { no } from "@/lib/locale/no";
import { initials, matchTime } from "@/lib/client/view";
import { resolve } from "@/lib/tournament/scoring";
import { BoardTimer } from "./BoardTimer";
import type { Court, Match, ScoringConfig, Team } from "@/lib/types";

// "Now playing": one big card (sequential) or a per-court grid (parallel).

export function NowPlaying({
  live,
  called = [],
  teams,
  courts,
  scoring,
  parallel,
  upNext = null,
}: {
  live: Match[];
  /** Kalt opp til en bane, ikke startet ennå (A3). */
  called?: Match[];
  teams: Map<string, Team>;
  courts: Court[];
  scoring: ScoringConfig;
  parallel: boolean;
  /** Neste kamp i køen. Vises i stedet for en tom ramme mellom to kamper. */
  upNext?: Match | null;
}) {
  // Sequential with nothing live: the called match is "up next, on its way".
  if (live.length === 0 && called.length > 0 && !(parallel && courts.length > 0))
    return (
      <div className="now-card">
        <div className="now-label">
          <span className="dot" />
          {no.board.calledUp}
          {called[0].court_id && courtName(courts, called[0].court_id) && (
            <span className="next-court now-court">
              {courtName(courts, called[0].court_id)}
            </span>
          )}
        </div>
        <Versus m={called[0]} teams={teams} scoring={scoring} />
      </div>
    );

  // Between two matches: show what is coming, not an empty frame.
  if (live.length === 0 && !(parallel && courts.length > 0 && called.length > 0))
    return (
      <div className="now-card">
        <div className="now-label">
          {no.board.nextMatch}
          {upNext?.court_id && courtName(courts, upNext.court_id) && (
            <span className="next-court now-court">{courtName(courts, upNext.court_id)}</span>
          )}
        </div>
        {upNext ? (
          <Versus m={upNext} teams={teams} scoring={scoring} />
        ) : (
          <div className="empty now-empty">{no.board.waitingNext}</div>
        )}
      </div>
    );

  if (parallel && courts.length > 0) {
    // Two columns from three courts up, so the grid stays inside the card.
    const cols = courts.length <= 2 ? 1 : 2;
    return (
      <div className="now-card now-card-grid">
        <div className="now-label">
          <span className="dot" />
          {no.board.nowPlaying}
        </div>
        <div
          className="court-grid"
          style={{ ["--cols" as string]: cols, ["--rows" as string]: Math.ceil(courts.length / cols) }}
        >
          {courts.map((c) => {
            const m = live.find((lm) => lm.court_id === c.id);
            const cm = m ? undefined : called.find((x) => x.court_id === c.id);
            return (
              <div className="court-card" key={c.id}>
                <div className="court-head">
                  <span className="court-name">{c.name}</span>
                  <BoardTimer timer={c.timer} compact />
                </div>
                {m ? (
                  <Versus m={m} teams={teams} scoring={scoring} compact />
                ) : cm ? (
                  <div className="stack court-called">
                    <span className="pill pill-gold">{no.board.calledUp}</span>
                    <Versus m={cm} teams={teams} scoring={scoring} compact />
                  </div>
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

function courtName(courts: Court[], id: string): string | null {
  return courts.find((c) => c.id === id)?.name ?? null;
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

  // Sets profile: the tally is sets won; the running set scores (from the live
  // feed or the final result) go on a line beneath.
  const setLine =
    scoring.profile === "sets" && m.result && "sets" in m.result
      ? m.result.sets.map(([hs, as]) => `${hs}–${as}`).join("  ·  ")
      : null;
  // Per-court cards: a small scoreboard (one line per team) instead of the big
  // face-off, so a short card can still carry large type.
  if (compact)
    return (
      <div className="stack versus-wrap">
        <div className="vc">
          <CompactRow team={h} score={r?.homeScore} />
          <CompactRow team={a} score={r?.awayScore} />
        </div>
        {setLine && <div className="versus-sets versus-sets-sm">{setLine}</div>}
      </div>
    );
  return (
    <div className="stack versus-wrap">
      <div className="versus">
        <Side team={h} score={r?.homeScore} />
        <span className="versus-mid">{no.common.vs}</span>
        <Side team={a} score={r?.awayScore} right />
      </div>
      {matchTime(m.scheduled_at) && (
        <div className="match-time">{no.board.plannedAt(matchTime(m.scheduled_at)!)}</div>
      )}
      {setLine && (
        <div className={`versus-sets${compact ? " versus-sets-sm" : ""}`}>
          {setLine}
        </div>
      )}
    </div>
  );
}

function CompactRow({
  team,
  score,
}: {
  team: Team | null | undefined;
  score: number | undefined;
}) {
  return (
    <div className="vc-row">
      <span className="vc-name">{team?.name ?? no.board.tbd}</span>
      {score != null && <span className="vc-score">{score}</span>}
    </div>
  );
}

function Side({
  team,
  score,
}: {
  team: Team | null | undefined;
  score: number | undefined;
  right?: boolean;
}) {
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
