"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { myTournaments } from "@/lib/client/myTournaments";
import { QRCode } from "@/lib/client/QRCode";
import { Icon } from "@/lib/client/Icon";
import { teamMap, matchTime } from "@/lib/client/view";
import {
  cardMatches,
  controlCourtUrl,
  controlMatchUrl,
  playoffRounds,
  programmeByCourt,
  programmeByTeam,
  roundText,
  scoreBoxes,
} from "@/lib/tournament/printout";
import { no } from "@/lib/locale/no";
import type { StateDTO } from "@/lib/dto";
import type { Match, Team } from "@/lib/types";

// Utskrift for kampdagen: kampprogram, kampkort og banekort. Kontrollkoden til
// QR-kodene er ikke i den offentlige tilstanden — den hentes fra denne enhetens
// egen lagring (samme sted som /arrangor/[id]), så siden krever arrangørkoden
// på enheten og ingenting ekstra forlater serveren.
export function PrintClient({ id }: { id: string }) {
  // undefined = ikke lest ennå; null = ingen arrangørtilgang på denne enheten
  const [access, setAccess] = useState<{ control: string | null } | null | undefined>(undefined);
  const [state, setState] = useState<StateDTO | null>(null);
  const [error, setError] = useState(false);
  const [showCourt, setShowCourt] = useState(true);
  const [showTeam, setShowTeam] = useState(false);
  const [showCards, setShowCards] = useState(true);
  const [showCourtCards, setShowCourtCards] = useState(true);
  const [onlyKnown, setOnlyKnown] = useState(true);

  useEffect(() => {
    const mine = myTournaments.get(id);
    const organiser = mine?.organiser_code || identity.organiserCode(id);
    const control = mine?.control_code || identity.controlCode(id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read device storage post-mount
    setAccess(organiser ? { control: control || null } : null);
  }, [id]);

  useEffect(() => {
    if (!access) return;
    api.fetchState(id).then(setState, () => setError(true));
  }, [id, access]);

  if (access === undefined)
    return <main className="center-screen"><span className="spin" /></main>;
  if (access === null)
    return (
      <main className="center-screen">
        <div className="card card-pad stack center" style={{ maxWidth: 440, width: "100%" }}>
          <h2>{no.print.noAccessTitle}</h2>
          <p className="faint">{no.print.noAccessBody}</p>
          <Link href={`/arrangor/${id}`} className="btn btn-gold btn-block">
            {no.print.toOrganiser}
          </Link>
        </div>
      </main>
    );
  if (error) return <main className="center-screen"><div className="empty">{no.common.error}</div></main>;
  if (!state) return <main className="center-screen"><span className="spin" /></main>;

  const base =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const { tournament, matches, courts, teams } = state;
  const byId = teamMap(teams);
  const courtName = new Map(courts.map((c) => [c.id, c.name]));
  const rounds = playoffRounds(matches);
  const label = (m: Match) => roundText(m, rounds);
  const byCourt = showCourt ? programmeByCourt(matches, courts, onlyKnown) : [];
  const byTeam = showTeam ? programmeByTeam(matches, teams, onlyKnown) : [];
  const cards = showCards ? cardMatches(matches, onlyKnown) : [];
  const courtCards = showCourtCards ? courts : [];
  const boxes = scoreBoxes(tournament.scoring);
  const control = access.control;
  const nothing = !byCourt.length && !byTeam.length && !cards.length && !courtCards.length;

  return (
    <main className="print-page">
      <div className="print-toolbar card card-pad stack">
        <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
          <Link href={`/arrangor/${id}`} className="faint back-link">
            <Icon name="back" size={16} />
            {no.print.back}
          </Link>
          <button className="btn btn-gold" onClick={() => window.print()}>
            <Icon name="print" />
            {no.print.action}
          </button>
        </div>
        <strong>{no.print.choose}</strong>
        <div className="print-options">
          <Check label={no.print.programmeCourt} on={showCourt} set={setShowCourt} />
          <Check label={no.print.programmeTeam} on={showTeam} set={setShowTeam} />
          <Check label={no.print.matchCards} on={showCards} set={setShowCards} />
          <Check label={no.print.courtCards} on={showCourtCards} set={setShowCourtCards} />
          <Check label={no.print.onlyKnown} on={onlyKnown} set={setOnlyKnown} />
        </div>
        {!control && (showCards || showCourtCards) && (
          <div className="panel" role="status">{no.print.noControlCode}</div>
        )}
        {nothing && <div className="empty">{no.print.nothing}</div>}
      </div>

      <div className="print-sheet">
        {byCourt.map((g) => (
          <section className="ps-block" key={g.court?.id ?? "none"}>
            <h2>{tournament.title} — {g.court?.name ?? no.print.noCourt}</h2>
            <table className="ps-table">
              <thead>
                <tr>
                  <th>{no.print.time}</th>
                  <th>{no.print.match}</th>
                  <th>{no.print.round}</th>
                </tr>
              </thead>
              <tbody>
                {g.matches.map((m) => (
                  <tr key={m.id}>
                    <td>{matchTime(m.scheduled_at) ?? no.print.noTime}</td>
                    <td>{teamName(byId, m.home_team_id)} – {teamName(byId, m.away_team_id)}</td>
                    <td>{label(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        {byTeam.length > 0 && (
          <section className="ps-block">
            <h2>{tournament.title} — {no.print.programmeTeam}</h2>
            {byTeam.map((g) => (
              <div className="ps-team" key={g.team.id}>
                <h3><Swatch team={g.team} /> {g.team.name}</h3>
                <table className="ps-table">
                  <tbody>
                    {g.matches.map((m) => {
                      const other = m.home_team_id === g.team.id ? m.away_team_id : m.home_team_id;
                      return (
                        <tr key={m.id}>
                          <td>{matchTime(m.scheduled_at) ?? no.print.noTime}</td>
                          <td>{m.court_id ? courtName.get(m.court_id) ?? "" : ""}</td>
                          <td>{no.print.vs} {teamName(byId, other)}</td>
                          <td>{label(m)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        )}

        {cards.length > 0 && (
          <section className="ps-block ps-cards">
            {cards.map((m) => {
              const home = m.home_team_id ? byId.get(m.home_team_id) : undefined;
              const away = m.away_team_id ? byId.get(m.away_team_id) : undefined;
              return (
                <article className="ps-card" key={m.id}>
                  <header>
                    <strong>{tournament.title}</strong>
                    <span>{label(m)}</span>
                  </header>
                  <div className="ps-meta">
                    <span>{no.print.time}: <b>{matchTime(m.scheduled_at) ?? no.print.noTime}</b></span>
                    <span>{no.print.court}: <b>{m.court_id ? courtName.get(m.court_id) ?? "" : no.print.noTime}</b></span>
                  </div>
                  <div className="ps-teams-row">
                    <TeamName team={home} />
                    <span className="ps-vs">{no.print.vs}</span>
                    <TeamName team={away} />
                  </div>
                  <div className="ps-score">
                    {boxes.kind === "simple" && (
                      <div className="ps-box-row">
                        <span className="ps-box" /> <span>–</span> <span className="ps-box" />
                      </div>
                    )}
                    {boxes.kind === "sets" &&
                      Array.from({ length: boxes.sets }, (_, i) => (
                        <div className="ps-box-row" key={i}>
                          <span className="ps-setlabel">{no.print.set(i + 1)}</span>
                          <span className="ps-box ps-box-sm" /> <span>–</span> <span className="ps-box ps-box-sm" />
                        </div>
                      ))}
                    {boxes.kind === "winner" && (
                      <div className="ps-ticks">
                        <span><span className="ps-tick" /> {no.print.homeWon}</span>
                        <span><span className="ps-tick" /> {no.print.awayWon}</span>
                      </div>
                    )}
                  </div>
                  <footer>
                    <div className="ps-sign">{no.print.signature}</div>
                    {control && (
                      <div className="ps-qr">
                        <QRCode
                          value={controlMatchUrl(base, control, m.id)}
                          size={104}
                          alt={no.print.qrMatchAlt}
                        />
                        <small>{no.print.scan}</small>
                      </div>
                    )}
                  </footer>
                </article>
              );
            })}
          </section>
        )}

        {courtCards.map((c) => (
          <section className="ps-block ps-courtcard" key={c.id}>
            <small>{tournament.title}</small>
            <h1>{c.name}</h1>
            {control && (
              <QRCode
                value={controlCourtUrl(base, control, c.id)}
                size={260}
                alt={no.print.qrCourtAlt}
              />
            )}
            <h3>{no.print.courtCardHow}</h3>
            <ol>
              {no.print.courtCardSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <small>{no.print.courtCardWarn}</small>
          </section>
        ))}
      </div>
    </main>
  );
}

function teamName(byId: Map<string, Team>, id: string | null): string {
  return (id && byId.get(id)?.name) || no.print.tbd;
}

function Swatch({ team }: { team: Team }) {
  return <span className="ps-swatch" style={{ background: team.colour }} />;
}

function TeamName({ team }: { team: Team | undefined }) {
  return (
    <span className="ps-team-name">
      {team ? (
        team.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-supplied logo URL
          <img className="ps-logo" src={team.logo_url} alt="" />
        ) : (
          <Swatch team={team} />
        )
      ) : null}
      {team?.name ?? no.print.tbd}
    </span>
  );
}

function Check({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="print-check">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {label}
    </label>
  );
}
