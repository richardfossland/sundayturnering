"use client";

import { no } from "@/lib/locale/no";
import { bracketRoundLabel } from "@/lib/client/view";
import { resolve } from "@/lib/tournament/scoring";
import type { Match, ScoringConfig, Team } from "@/lib/types";

export function Bracket({
  matches,
  teams,
  scoring,
}: {
  matches: Match[];
  teams: Map<string, Team>;
  scoring: ScoringConfig;
}) {
  const playoff = matches.filter((m) => m.phase === "playoff");
  if (playoff.length === 0)
    return <div className="empty">{no.board.noMatches}</div>;

  const totalRounds = Math.max(...playoff.map((m) => m.round));
  const rounds: Match[][] = [];
  for (let r = 1; r <= totalRounds; r++)
    rounds.push(
      playoff
        .filter((m) => m.round === r)
        .sort((a, b) => (a.bracket_slot ?? 0) - (b.bracket_slot ?? 0)),
    );

  return (
    <div className="bracket">
      {rounds.map((col, i) => (
        <div className="bracket-round" key={i}>
          <div className="bracket-round-label">
            {bracketRoundLabel(i + 1, totalRounds)}
          </div>
          {col.map((m) => (
            <BracketMatch key={m.id} m={m} teams={teams} scoring={scoring} />
          ))}
        </div>
      ))}
    </div>
  );
}

function BracketMatch({
  m,
  teams,
  scoring,
}: {
  m: Match;
  teams: Map<string, Team>;
  scoring: ScoringConfig;
}) {
  const r = m.result ? resolve(scoring.profile, m.result) : null;
  const homeWin = m.winner_team_id && m.winner_team_id === m.home_team_id;
  const awayWin = m.winner_team_id && m.winner_team_id === m.away_team_id;
  return (
    <div className="bx">
      <Row
        team={m.home_team_id ? teams.get(m.home_team_id) : null}
        score={r?.homeScore}
        win={!!homeWin}
        bye={m.status === "bye"}
      />
      <Row
        team={m.away_team_id ? teams.get(m.away_team_id) : null}
        score={r?.awayScore}
        win={!!awayWin}
        bye={m.status === "bye"}
      />
    </div>
  );
}

function Row({
  team,
  score,
  win,
  bye,
}: {
  team: Team | null | undefined;
  score: number | undefined;
  win: boolean;
  bye: boolean;
}) {
  return (
    <div className={`bx-row${win ? " win" : ""}`}>
      {team ? (
        <span className="team">
          <span className="team-swatch" style={{ background: team.colour, width: 13, height: 13 }} />
          <span className="team-name">{team.name}</span>
        </span>
      ) : (
        <span className="bx-tbd">{bye ? no.board.bye : no.board.tbd}</span>
      )}
      {score != null && <span className="bx-score">{score}</span>}
    </div>
  );
}
