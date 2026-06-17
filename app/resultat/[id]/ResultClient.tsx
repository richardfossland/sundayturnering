"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { no, aw } from "@/lib/locale/no";
import { initials, finalRanking, championId, teamMap } from "@/lib/client/view";
import { computeAwards } from "@/lib/tournament/awards";
import { matchesCsv, standingsCsv } from "@/lib/tournament/csv";
import { downloadText, safeFilename } from "@/lib/client/download";
import type { StateDTO } from "@/lib/dto";
import type { Team } from "@/lib/types";

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

  const ranked = finalRanking(state);
  const champ = championId(state);
  const champTeam = ranked.find((t) => t.id === champ) ?? ranked[0];
  const awards = computeAwards(
    state.teams,
    state.matches,
    state.standings,
    state.tournament.scoring,
  );
  const byId = teamMap(state.teams);

  return (
    <main className="result-page">
      <div className="result-actions">
        <button className="btn btn-gold" onClick={() => window.print()}>
          🖨️ Skriv ut / lagre som PDF
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
          ⬇️ Tabell (CSV)
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
          ⬇️ Resultater (CSV)
        </button>
      </div>

      <div className="result-sheet">
        <header className="result-head">
          <span className="brand">
            <span className="brand-mark">T</span>
            {no.brand}
          </span>
          <h1>{state.tournament.title || "Turnering"}</h1>
          {state.tournament.sport_label && (
            <div className="result-sport">{state.tournament.sport_label}</div>
          )}
        </header>

        {champTeam && (
          <section className="result-champ">
            <div className="result-champ-eyebrow">🏆 Vinner</div>
            <TeamCrest team={champTeam} size={86} />
            <div className="result-champ-name">{champTeam.name}</div>
          </section>
        )}

        <section className="result-podium">
          {ranked.map((t, i) => (
            <div className="diploma" key={t.id}>
              <div className="diploma-place">{medal(i + 1)}</div>
              <TeamCrest team={t} size={54} />
              <div className="diploma-name">{t.name}</div>
              {t.members.length > 0 && (
                <div className="diploma-members">{t.members.join(" · ")}</div>
              )}
            </div>
          ))}
        </section>

        {awards.length > 0 && (
          <section className="result-awards">
            <h2 className="result-awards-title">{aw.title}</h2>
            <div className="awards-grid">
              {awards.map((a) => (
                <div className="award-card" key={a.kind}>
                  <div className="award-label">{a.label}</div>
                  <div className="award-team">
                    {a.teamId && byId.get(a.teamId) ? (
                      <>
                        <span
                          className="team-swatch"
                          style={{ background: byId.get(a.teamId)!.colour, width: 14, height: 14 }}
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

        {state.standings.some((s) => s.played > 0) && (
          <section className="result-records">
            <h2 className="result-awards-title">{no.board.standings}</h2>
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
                {state.standings.map((r) => (
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
          </section>
        )}

        <footer className="result-foot">
          turnering.sundaysuite.app
        </footer>
      </div>
    </main>
  );
}

function medal(place: number): string {
  if (place === 1) return "🥇 1.";
  if (place === 2) return "🥈 2.";
  if (place === 3) return "🥉 3.";
  return `${place}.`;
}

function TeamCrest({ team, size }: { team: Team; size: number }) {
  if (team.logo_url)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={team.logo_url} alt="" width={size} height={size} style={{ borderRadius: size * 0.22, objectFit: "cover" }} />;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: team.colour,
        display: "grid",
        placeItems: "center",
        color: "#fff",
        fontFamily: "var(--display)",
        fontWeight: 900,
        fontSize: size * 0.4,
      }}
    >
      {initials(team.name)}
    </div>
  );
}
