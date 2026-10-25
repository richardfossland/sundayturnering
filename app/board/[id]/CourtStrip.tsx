"use client";

import { no } from "@/lib/locale/no";
import { matchTime } from "@/lib/client/view";
import { resolve } from "@/lib/tournament/scoring";
import { courtStrip } from "@/lib/tournament/courts";
import type { Court, Match, ScoringConfig, Team } from "@/lib/types";

// «Baner»: én kolonne per bane — Spiller nå / Kalt opp (gull) / Neste med tid.
// Lesbar på projektor: store lagnavn, ingen skrolling (maks tre «neste»).

export function CourtStrip({
  matches,
  courts,
  teams,
  scoring,
}: {
  matches: Match[];
  courts: Court[];
  teams: Map<string, Team>;
  scoring: ScoringConfig;
}) {
  const lanes = courtStrip(matches, courts);
  return (
    <div className="court-strip" style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(0, 1fr))` }}>
      {lanes.map(({ court, live, called, next }) => (
        <div className="court-col" key={court.id}>
          <div className="court-col-name">{court.name}</div>

          <div className="court-slot">
            <div className="court-slot-label">
              <span className="dot" />
              {no.board.nowPlaying}
            </div>
            {live ? <Teams m={live} teams={teams} scoring={scoring} score /> : <div className="faint">—</div>}
          </div>

          {called && (
            <div className="court-slot court-slot-called">
              <div className="court-slot-label">{no.board.calledUp}</div>
              <Teams m={called} teams={teams} scoring={scoring} />
            </div>
          )}

          <div className="court-slot">
            <div className="court-slot-label">{no.board.nextUp}</div>
            {next.length === 0 ? (
              <div className="faint">—</div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {next.map((m) => (
                  <div className="court-next" key={m.id}>
                    {matchTime(m.scheduled_at) && <span className="match-time">{matchTime(m.scheduled_at)}</span>}
                    <Teams m={m} teams={teams} scoring={scoring} inline />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Teams({
  m,
  teams,
  scoring,
  score,
  inline,
}: {
  m: Match;
  teams: Map<string, Team>;
  scoring: ScoringConfig;
  score?: boolean;
  inline?: boolean;
}) {
  const h = m.home_team_id ? teams.get(m.home_team_id) : null;
  const a = m.away_team_id ? teams.get(m.away_team_id) : null;
  const r = score && m.result ? resolve(scoring.profile, m.result) : null;
  const line = (t: Team | null | undefined, s?: number) => (
    <span className="court-team">
      <span className="team-swatch" style={{ background: t?.colour }} />
      <span className="team-name">{t?.name ?? no.board.tbd}</span>
      {s != null && <span className="court-score">{s}</span>}
    </span>
  );
  return (
    <div className={inline ? "court-teams court-teams-inline" : "court-teams"}>
      {line(h, r?.homeScore)}
      {inline && <span className="next-vs">{no.common.vs}</span>}
      {line(a, r?.awayScore)}
    </div>
  );
}
