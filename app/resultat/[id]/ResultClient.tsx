"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { no, aw } from "@/lib/locale/no";
import { initials, finalRanking, championId, bChampionId, teamMap } from "@/lib/client/view";
import { computeAwards } from "@/lib/tournament/awards";
import { matchesCsv, standingsCsv } from "@/lib/tournament/csv";
import { downloadText, safeFilename } from "@/lib/client/download";
import { Icon } from "@/lib/client/Icon";
import type { StateDTO } from "@/lib/dto";
import type { StandingRow, Team } from "@/lib/types";
import { groupLabel, StandingsLegend } from "@/app/board/[id]/Standings";
import { hasStandingsTable } from "@/app/board/[id]/BoardStandingsPanel";

// Printable results + diplomas. "Skriv ut / lagre PDF" uses the browser's
// print-to-PDF (print CSS forces a clean white sheet).
export function ResultClient({ id }: { id: string }) {
  const [state, setState] = useState<StateDTO | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.fetchState(id).then(setState, () => setError(true));
  }, [id]);

  if (error) return <main className="center-screen"><div className="empty">{no.common.error}</div></main>;
  if (!state) return <main className="center-screen"><span className="spin" /></main>;

  // Until the organiser ends the tournament this is a snapshot, not a result:
  // no winner, no medals (A3) — just the table as it stands.
  const finished = state.tournament.status === "finished";
  const ranked = finalRanking(state);
  const champ = championId(state);
  const champTeam = champ ? ranked.find((t) => t.id === champ) : undefined;
  // Avsluttet før finalen var spilt: ingen vinner å kåre, bare stillingen slik den sto.
  const endedEarly =
    finished && !champ && state.tournament.format !== "league" && state.tournament.format !== "swiss";
  const awards = computeAwards(
    state.teams,
    state.matches,
    state.standings,
    state.tournament.scoring,
    { championId: champ, groupPlay: state.tournament.format === "group_playoff" },
  );
  const byId = teamMap(state.teams);
  const bTeam = finished ? byId.get(bChampionId(state.matches) ?? "") : undefined;
  const played = state.standings.some((s) => s.played > 0);

  return (
    <main className="result-page">
      <div className="result-actions">
        <button className="btn btn-gold" onClick={() => window.print()}>
          <Icon name="print" />
          {no.result.print}
        </button>
        <button
          className="btn"
          onClick={() =>
            downloadText(
              `${safeFilename(state.tournament.title)}-tabell.csv`,
              standingsCsv(state.teams, state.standings),
            )
          }
        >
          <Icon name="download" />
          {no.result.csvStandings}
        </button>
        <button
          className="btn"
          onClick={() =>
            downloadText(
              `${safeFilename(state.tournament.title)}-resultater.csv`,
              matchesCsv(state.teams, state.matches, state.tournament.scoring),
            )
          }
        >
          <Icon name="download" />
          {no.result.csvResults}
        </button>
      </div>

      <div className="result-sheet">
        <header className="result-head">
          <span className="brand">
            <span className="brand-mark">T</span>
            {no.brand}
          </span>
          <h1>{state.tournament.title || no.result.fallbackTitle}</h1>
          {state.tournament.sport_label && (
            <div className="result-sport">{state.tournament.sport_label}</div>
          )}
        </header>

        {!finished && (
          <section className="result-provisional" role="status">
            <h2 className="result-provisional-title">
              <Icon name="clock" size={20} />
              {no.result.provisional}
            </h2>
            <p>{no.result.notFinished}</p>
          </section>
        )}

        {finished && champTeam && (
          <section className="result-champ">
            <div className="result-champ-eyebrow">
              <Icon name="trophy" size={18} />
              {no.result.winner}
            </div>
            <TeamCrest team={champTeam} size="lg" />
            <div className="result-champ-name">{champTeam.name}</div>
          </section>
        )}

        {endedEarly && (
          <section className="result-provisional" role="status">
            <h2 className="result-provisional-title">
              <Icon name="clock" size={20} />
              {no.result.endedEarly}
            </h2>
          </section>
        )}

        {bTeam && (
          <section className="result-champ">
            <div className="result-champ-eyebrow">
              {state.tournament.config?.consolation === "first_round_losers"
                ? no.board.winnerBCup
                : no.board.winnerB}
            </div>
            <TeamCrest team={bTeam} size="md" />
            <div className="result-champ-name">{bTeam.name}</div>
          </section>
        )}

        {finished && (
          <section className="result-sec">
            <h2 className="result-sec-title">
              {endedEarly ? no.result.rankingEarly : no.result.ranking}
            </h2>
            <div className="result-podium">
              {ranked.map((t, i) => (
                <div className="diploma" key={t.id}>
                  <div className="diploma-place">{endedEarly ? `${i + 1}.` : medal(i + 1)}</div>
                  <TeamCrest team={t} size="md" />
                  <div className="diploma-name">{t.name}</div>
                  {t.members.length > 0 && (
                    <div className="diploma-members">{t.members.join(" · ")}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {finished && awards.length > 0 && (
          <section className="result-sec">
            <h2 className="result-sec-title">{aw.title}</h2>
            <div className="awards-grid">
              {awards.map((a) => (
                <div className="award-card" key={a.kind}>
                  <div className="award-label">{a.label}</div>
                  <div className="award-team">
                    {a.teamId && byId.get(a.teamId) ? (
                      <>
                        <span
                          className="team-swatch award-swatch"
                          style={{ background: byId.get(a.teamId)!.colour }}
                        />
                        {byId.get(a.teamId)!.name}
                      </>
                    ) : (
                      a.detail
                    )}
                  </div>
                  {a.teamId && <div className="award-detail">{a.detail}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {hasStandingsTable(state.tournament.format) && (
          <section className="result-sec">
            <h2 className="result-sec-title">{no.board.standings}</h2>
            {!played ? (
              <div className="empty">{no.board.noMatches}</div>
            ) : (
              <>
                {state.groupStandings && state.groupStandings.length > 0 ? (
                  // Gruppespill: one table per group. The flat `standings` ranks
                  // teams that never met against each other (the board and /se
                  // already show per-group tables).
                  state.groupStandings.map((g) => (
                    <div key={g.group_no} className="result-group">
                      <h3 className="group-head">{groupLabel(g.group_no)}</h3>
                      <RecordsTable rows={g.rows} byId={byId} />
                    </div>
                  ))
                ) : (
                  <RecordsTable rows={state.standings} byId={byId} />
                )}
                <StandingsLegend standings={state.standings} showDraw />
              </>
            )}
          </section>
        )}

        <footer className="result-foot">
          turnering.sundaysuite.app
        </footer>
      </div>
    </main>
  );
}

/** Top three get a medal glyph in gold / silver / bronze; the rest a plain number. */
function medal(place: number): React.ReactNode {
  if (place >= 1 && place <= 3)
    return (
      <span className={`place place-${place}`}>
        <Icon name="medal" size={28} />
        {place}.
      </span>
    );
  return `${place}.`;
}

/** Logo or coloured initials. `lg` = winner, `md` = podium cards. */
function TeamCrest({ team, size }: { team: Team; size: "md" | "lg" }) {
  if (team.logo_url)
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`crest crest-${size}`} src={team.logo_url} alt="" />;
  return (
    <div className={`crest crest-${size}`} style={{ background: team.colour }}>
      {initials(team.name)}
    </div>
  );
}

function RecordsTable({ rows, byId }: { rows: StandingRow[]; byId: Map<string, Team> }) {
  return (
    <table className="standings result-records-table">
      <thead>
        <tr>
          <th>#</th>
          <th className="l">{no.board.th.team}</th>
          <th>{no.board.th.p}</th>
          <th>{no.board.th.w}</th>
          <th>{no.board.th.d}</th>
          <th>{no.board.th.l}</th>
          <th>{no.board.th.diff}</th>
          <th>{no.board.th.pts}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.team_id}>
            <td className="rank">{r.rank}</td>
            <td className="l">{byId.get(r.team_id)?.name ?? "?"}</td>
            <td>{r.played}</td>
            <td>{r.won}</td>
            <td>{r.drawn}</td>
            <td>{r.lost}</td>
            <td>{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
            <td className="pts">{r.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
