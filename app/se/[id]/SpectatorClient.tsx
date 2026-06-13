"use client";

import { useMemo } from "react";
import { useTournament } from "@/lib/client/useTournament";
import { useReactionSender } from "@/lib/client/useReactionSender";
import { teamMap, liveMatches, upcoming } from "@/lib/client/view";
import { reactionEmoji } from "@/lib/realtime";
import type { ReactionKind } from "@/lib/realtime";
import { no } from "@/lib/locale/no";
import { Standings } from "@/app/board/[id]/Standings";
import type { Court, Match, Team } from "@/lib/types";

const BUTTONS: { kind: ReactionKind; label: string }[] = [
  { kind: "clap", label: no.spectator.reactClap },
  { kind: "fire", label: no.spectator.reactFire },
  { kind: "goal", label: no.spectator.reactGoal },
];

export function SpectatorClient({ id }: { id: string }) {
  // Read-only: refetch authoritative state on hints, never write.
  const { state, error } = useTournament(id);
  const react = useReactionSender(id);
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
  const live = liveMatches(matches);
  const next = upcoming(matches, 4);
  const finished = tournament.status === "finished";

  return (
    <main className="spectator">
      <header className="spectator-head">
        <h1 className="spectator-title">{tournament.title || no.brand}</h1>
        {tournament.sport_label && (
          <div className="board-sport">{tournament.sport_label}</div>
        )}
      </header>

      {/* Tap-to-react: the headline interaction, kept above the fold on a phone. */}
      <section className="react-pad" aria-label={no.spectator.title}>
        <div className="react-intro">{no.spectator.intro}</div>
        <div className="react-buttons">
          {BUTTONS.map((b) => (
            <button
              key={b.kind}
              type="button"
              className={`react-btn react-btn-${b.kind}`}
              onClick={() => react(b.kind)}
              aria-label={b.label}
            >
              <span className="react-btn-emoji">{reactionEmoji[b.kind]}</span>
              <span className="react-btn-label">{b.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="spectator-now panel">
        <div className="section-title">{no.spectator.nowPlaying}</div>
        {finished ? (
          <div className="empty">{no.spectator.finished}</div>
        ) : live.length === 0 ? (
          <div className="empty">{no.spectator.nothingLive}</div>
        ) : (
          <div className="stack">
            {live.map((m) => (
              <MatchRow key={m.id} m={m} teams={teams} courts={courts} />
            ))}
          </div>
        )}
        {!finished && next.length > 0 && (
          <>
            <div className="section-title" style={{ marginTop: 14 }}>
              {no.spectator.nextUp}
            </div>
            <div className="stack">
              {next.map((m) => (
                <MatchRow key={m.id} m={m} teams={teams} courts={courts} muted />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card card-pad">
        <div className="section-title">{no.spectator.standings}</div>
        <Standings
          standings={standings}
          teams={teams}
          showDraw={
            tournament.scoring.profile === "simple" && tournament.scoring.allowDraw
          }
        />
      </section>
    </main>
  );
}

function MatchRow({
  m,
  teams,
  courts,
  muted,
}: {
  m: Match;
  teams: Map<string, Team>;
  courts: Court[];
  muted?: boolean;
}) {
  const h = m.home_team_id ? teams.get(m.home_team_id) : null;
  const a = m.away_team_id ? teams.get(m.away_team_id) : null;
  const court = courts.find((c) => c.id === m.court_id);
  return (
    <div className={`next-row${muted ? " faint" : ""}`}>
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
