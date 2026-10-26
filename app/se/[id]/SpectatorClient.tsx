"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { OfflineBanner } from "@/lib/client/OfflineBanner";
import { useTournament } from "@/lib/client/useTournament";
import { useReactionSender } from "@/lib/client/useReactionSender";
import {
  teamMap,
  liveMatches,
  upcoming,
  matchTime,
  championId,
} from "@/lib/client/view";
import { Icon, reactionIcon } from "@/lib/client/Icon";
import type { ReactionKind } from "@/lib/realtime";
import { no } from "@/lib/locale/no";
import { resolve } from "@/lib/tournament/scoring";
import { Standings, GroupStandings, StandingsLegend } from "@/app/board/[id]/Standings";
import { Bracket } from "@/app/board/[id]/Bracket";
import { hasStandingsTable } from "@/app/board/[id]/BoardStandingsPanel";
import type { StateDTO } from "@/lib/dto";
import type { Court, Match, ScoringConfig, Team } from "@/lib/types";

const BUTTONS: { kind: ReactionKind; label: string }[] = [
  { kind: "clap", label: no.spectator.reactClap },
  { kind: "fire", label: no.spectator.reactFire },
  { kind: "goal", label: no.spectator.reactGoal },
];

type SectionId = "kamper" | "tabell" | "sluttspill" | "heie";

/** «Følg turneringen» — the one public phone page. Read-only: refetches
 * authoritative state on hints and never writes; the only thing it sends is
 * the ephemeral cheer broadcast (useReactionSender). */
export function SpectatorClient({ id }: { id: string }) {
  // A whole gym of phones gets the same broadcast at once — jitter spreads the refetches.
  const { state, error, failures, lastOkAt } = useTournament(id, { jitterMs: 1500 });
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

  const { tournament, matches, standings, groupStandings, courts } = state;
  const showDraw = tournament.scoring.profile === "simple" && tournament.scoring.allowDraw;
  const live = liveMatches(matches);
  const next = upcoming(matches, 5);
  const finished = tournament.status === "finished";
  const started = matches.some((m) => m.status === "live" || m.status === "called" || m.status === "done");
  const hasBracket = matches.some((m) => m.phase === "playoff");
  const hasTable = hasStandingsTable(tournament.format);
  const champ = finished ? championId(state) : null;
  const champTeam = champ ? teams.get(champ) : undefined;

  const sections: { id: SectionId; label: string }[] = [
    ...(finished ? [] : [{ id: "kamper" as const, label: no.spectator.navMatches }]),
    ...(hasTable ? [{ id: "tabell" as const, label: no.spectator.navStandings }] : []),
    ...(hasBracket ? [{ id: "sluttspill" as const, label: no.spectator.navBracket }] : []),
    ...(finished ? [] : [{ id: "heie" as const, label: no.spectator.navCheer }]),
  ];

  return (
    <main className="follow">
      <OfflineBanner failures={failures} lastOkAt={lastOkAt} />
      <header className="follow-head">
        <div className="follow-meta">
          {tournament.sport_label && <span className="follow-sport">{tournament.sport_label}</span>}
          <span className={`pill${finished ? " pill-done" : started ? " pill-live" : ""}`}>
            {statusText(state, started)}
          </span>
        </div>
        <h1 className="follow-title">{tournament.title || no.brand}</h1>
      </header>

      {finished && (
        <section className="follow-champ" aria-label={no.spectator.finishedTitle}>
          <div className="follow-champ-eyebrow">
            <Icon name="trophy" size={20} />
            {no.spectator.finishedTitle}
          </div>
          {champTeam && (
            <>
              <div className="follow-champ-label">{no.spectator.winner}</div>
              <div className="follow-champ-name">
                <TeamMark team={champTeam} size="lg" />
                {champTeam.name}
              </div>
            </>
          )}
          <Link href={`/resultat/${tournament.id}`} className="btn btn-gold btn-block">
            <Icon name="award" />
            {no.spectator.toResults}
          </Link>
        </section>
      )}

      {sections.length > 1 && <FollowNav sections={sections} />}

      {!finished && (
        <section id="kamper" className="follow-sec">
          <h2 className="follow-h">{no.spectator.nowPlaying}</h2>
          {live.length > 0 ? (
            <div className="follow-live">
              {live.map((m) => (
                <LiveCard key={m.id} m={m} teams={teams} courts={courts} scoring={tournament.scoring} />
              ))}
            </div>
          ) : (
            <p className="follow-empty">
              {started ? no.spectator.nothingLive : no.spectator.notStarted}
            </p>
          )}

          <h2 className="follow-h">{no.spectator.nextUp}</h2>
          {next.length > 0 ? (
            <ul className="follow-next">
              {next.map((m) => (
                <NextRow key={m.id} m={m} teams={teams} courts={courts} />
              ))}
            </ul>
          ) : (
            <p className="follow-empty">{no.spectator.nextNone}</p>
          )}
        </section>
      )}

      {hasTable && (
        <section id="tabell" className="follow-sec">
          <h2 className="follow-h">{no.spectator.standings}</h2>
          <div className="card card-pad follow-card">
            {groupStandings && groupStandings.length > 0 ? (
              // Gruppespill: the flat `standings` merges every group into one
              // table (teams that never meet ranked against each other) — show
              // the per-group tables the board shows instead.
              <GroupStandings groups={groupStandings} teams={teams} showDraw={showDraw} compact />
            ) : (
              <Standings standings={standings} teams={teams} showDraw={showDraw} compact />
            )}
            <StandingsLegend standings={standings} showDraw={showDraw} />
          </div>
        </section>
      )}

      {hasBracket && (
        <section id="sluttspill" className="follow-sec">
          <h2 className="follow-h">{no.spectator.bracket}</h2>
          <div className="card card-pad follow-card">
            <p className="hint follow-hint">{no.spectator.bracketHint}</p>
            <Bracket
              matches={matches}
              teams={teams}
              scoring={tournament.scoring}
              links={state.links}
              consolation={tournament.config?.consolation}
            />
          </div>
        </section>
      )}

      {!finished && (
        <section id="heie" className="follow-sec">
          <h2 className="follow-h">{no.spectator.cheer}</h2>
          <div className="react-pad">
            <p className="react-intro">{no.spectator.cheerIntro}</p>
            <div className="react-buttons">
              {BUTTONS.map((b) => (
                <button
                  key={b.kind}
                  type="button"
                  className={`react-btn react-btn-${b.kind}`}
                  onClick={() => react(b.kind)}
                >
                  <Icon name={reactionIcon[b.kind]} size={30} strokeWidth={1.75} />
                  <span className="react-btn-label">{b.label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <p className="follow-foot">{no.spectator.updating}</p>
    </main>
  );
}

/** Status in plain words. Cup / double elimination have no «seriespill». */
function statusText(state: StateDTO, started: boolean): string {
  const { status, format } = state.tournament;
  const s = no.spectator.status;
  if (status === "finished") return s.finished;
  if (!started && status !== "playoff") return s.setup;
  if (status === "league" && (format === "cup" || format === "double_elim")) return s.cup;
  return s[status];
}

/** Sticky mini-nav: anchor links, the current section highlighted. */
function FollowNav({ sections }: { sections: { id: SectionId; label: string }[] }) {
  const [active, setActive] = useState<SectionId>(sections[0].id);
  const key = sections.map((s) => s.id).join(",");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = key.split(",") as SectionId[];
    const seen = new Map<string, boolean>();
    // A section counts as «current» while it crosses a band near the top.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = ids.find((i) => seen.get(i));
        if (first) setActive(first);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    for (const i of ids) {
      const el = document.getElementById(i);
      if (el) io.observe(el);
    }
    // The last section can be too short to ever reach the band: at the very
    // bottom of the page it is the current one.
    const onScroll = () => {
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atEnd) setActive(ids[ids.length - 1]);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [key]);

  return (
    <nav className="follow-nav" aria-label={no.spectator.navLabel}>
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="follow-nav-link"
          aria-current={active === s.id ? "true" : undefined}
          onClick={() => setActive(s.id)}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

function TeamMark({ team, size = "md" }: { team: Team | null | undefined; size?: "md" | "lg" }) {
  if (team?.logo_url)
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`follow-logo follow-logo-${size}`} src={team.logo_url} alt="" />;
  return (
    <span
      className={`follow-swatch follow-swatch-${size}`}
      style={{ background: team?.colour }}
      aria-hidden="true"
    />
  );
}

function LiveCard({
  m,
  teams,
  courts,
  scoring,
}: {
  m: Match;
  teams: Map<string, Team>;
  courts: Court[];
  scoring: ScoringConfig;
}) {
  const h = m.home_team_id ? teams.get(m.home_team_id) : null;
  const a = m.away_team_id ? teams.get(m.away_team_id) : null;
  const court = courts.find((c) => c.id === m.court_id);
  const r = m.result ? resolve(scoring.profile, m.result, scoring) : null;
  // Sets: the tally is sets won; the running set scores go on a line beneath.
  const setLine =
    scoring.profile === "sets" && m.result && "sets" in m.result
      ? m.result.sets.map(([hs, as]) => `${hs}–${as}`).join("  ·  ")
      : null;
  return (
    <article className="live-card">
      <header className="live-card-head">
        <span className="live-card-state">
          <span className="dot" />
          {no.spectator.liveNow}
        </span>
        {court && <span className="live-card-court">{court.name}</span>}
      </header>
      <LiveRow team={h} score={r?.homeScore} />
      <LiveRow team={a} score={r?.awayScore} />
      {setLine && <div className="live-card-sets">{setLine}</div>}
    </article>
  );
}

function LiveRow({
  team,
  score,
}: {
  team: Team | null | undefined;
  score: number | undefined;
}) {
  return (
    <div className="live-row">
      <TeamMark team={team} size="lg" />
      <span className="live-row-name">{team?.name ?? no.board.tbd}</span>
      {score != null && <span className="live-row-score">{score}</span>}
    </div>
  );
}

function NextRow({
  m,
  teams,
  courts,
}: {
  m: Match;
  teams: Map<string, Team>;
  courts: Court[];
}) {
  const h = m.home_team_id ? teams.get(m.home_team_id) : null;
  const a = m.away_team_id ? teams.get(m.away_team_id) : null;
  const court = courts.find((c) => c.id === m.court_id);
  const time = matchTime(m.scheduled_at);
  return (
    <li className="fn-row">
      {time && <span className="fn-time">{time}</span>}
      <span className="fn-teams">
        <span className="fn-team">
          <TeamMark team={h} />
          <span className="fn-name">{h?.name ?? no.board.tbd}</span>
        </span>
        <span className="fn-team">
          <TeamMark team={a} />
          <span className="fn-name">{a?.name ?? no.board.tbd}</span>
        </span>
      </span>
      {m.status === "called" ? (
        <span className="pill pill-called">
          {court ? no.control.calledTo(court.name) : no.board.calledUp}
        </span>
      ) : (
        court && <span className="fn-court">{court.name}</span>
      )}
    </li>
  );
}
