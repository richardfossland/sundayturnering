"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { ResultInput } from "@/lib/client/ResultInput";
import { resolve } from "@/lib/tournament/scoring";
import { no } from "@/lib/locale/no";
import type { Match, MatchResult, Team } from "@/lib/types";
import type { TournamentDTO } from "@/lib/dto";

export function OrganiserPanel({
  tournament,
  matches,
  teams,
  onChanged,
  flash,
}: {
  tournament: TournamentDTO;
  matches: Match[];
  teams: Map<string, Team>;
  onChanged: () => void;
  flash: (m: string) => void;
}) {
  const [openPanel, setOpenPanel] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<Match | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read stored code post-mount
    setCode(identity.organiserCode(tournament.id));
  }, [tournament.id]);

  function saveCode(c: string) {
    setCode(c);
    identity.setOrganiserCode(tournament.id, c);
  }

  async function guard<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    try {
      const r = await fn();
      onChanged();
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) flash(no.control.wrongOrganiserCode);
      else if (e instanceof ApiError && e.detail) flash(e.detail);
      else flash(no.common.error);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const canAdvance =
    (tournament.format === "league_playoff" ||
      tournament.format === "group_playoff") &&
    tournament.status === "league";
  const canFinish = tournament.status !== "finished";
  const doneMatches = matches.filter((m) => m.status === "done");

  if (!openPanel)
    return (
      <button className="btn btn-ghost btn-block" onClick={() => setOpenPanel(true)}>
        ⚙︎ {no.control.organiser}
      </button>
    );

  return (
    <div className="card card-pad stack">
      <div className="spread">
        <h2 style={{ fontSize: "1.2rem" }}>{no.control.organiser}</h2>
        <button className="btn btn-ghost" onClick={() => setOpenPanel(false)}>✕</button>
      </div>

      <a
        className="btn btn-block"
        href={`/resultat/${tournament.id}`}
        target="_blank"
        rel="noopener"
      >
        🏅 Resultater &amp; diplom
      </a>

      <div className="field">
        <label className="label">{no.control.organiserCode}</label>
        <input
          className="input"
          value={code}
          onChange={(e) => saveCode(e.target.value.toUpperCase())}
          placeholder="KODE-XX"
        />
        <span className="faint" style={{ fontSize: ".82rem" }}>
          {no.control.organiserHint}
        </span>
      </div>

      <div className="btn-row">
        {canAdvance && (
          <button
            className="btn btn-gold"
            disabled={busy || !code}
            onClick={async () => {
              if (!confirm(no.control.advanceConfirm)) return;
              const r = await guard(() => api.advance(tournament.id, code));
              if (r) flash(no.control.advancePlayoff);
            }}
          >
            {no.control.advancePlayoff}
          </button>
        )}
        {canFinish && (
          <button
            className="btn btn-danger"
            disabled={busy || !code}
            onClick={async () => {
              if (!confirm(no.control.finish + "?")) return;
              await guard(() => api.finish(tournament.id, code));
            }}
          >
            {no.control.finish}
          </button>
        )}
      </div>

      <div className="divider" />
      <div className="label">Kamp-timer (vises på tavla)</div>
      <div className="btn-row">
        {[5, 8, 10, 15].map((min) => (
          <button
            key={min}
            className="btn"
            disabled={busy || !code}
            onClick={() => guard(() => api.timer(tournament.id, code, "start", min * 60))}
          >
            {min} min
          </button>
        ))}
        <button
          className="btn btn-ghost"
          disabled={busy || !code}
          onClick={() => guard(() => api.timer(tournament.id, code, "add"))}
        >
          +1 min
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy || !code}
          onClick={() => guard(() => api.timer(tournament.id, code, "stop"))}
        >
          Stopp
        </button>
      </div>

      {doneMatches.length > 0 && (
        <>
          <div className="divider" />
          <div className="label">{no.control.override}</div>
          <div className="stack" style={{ gap: 8 }}>
            {doneMatches.map((m) => {
              const h = m.home_team_id ? teams.get(m.home_team_id) : null;
              const a = m.away_team_id ? teams.get(m.away_team_id) : null;
              const r = m.result ? resolve(tournament.scoring.profile, m.result) : null;
              const homeWon = !!(m.winner_team_id && m.winner_team_id === m.home_team_id);
              const awayWon = !!(m.winner_team_id && m.winner_team_id === m.away_team_id);
              return (
                <div className="match-card" key={m.id} style={{ cursor: "default" }}>
                  <div className="match-teams">
                    <span className={`team-name${homeWon ? " team-win" : ""}`}>
                      {h?.name}
                      {homeWon && <span className="win-mark"> ✓</span>}
                    </span>
                    <span className={`team-name${awayWon ? " team-win" : ""}`}>
                      {a?.name}
                      {awayWon && <span className="win-mark"> ✓</span>}
                    </span>
                  </div>
                  {/* Full scoreline (was truncated to the set tally before). */}
                  <span className="match-result">{r?.display}</span>
                  <button
                    className="btn btn-ghost"
                    disabled={!code}
                    onClick={() => setOverride(m)}
                  >
                    {no.control.edit}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {override && (
        <OverrideModal
          match={override}
          tournament={tournament}
          teams={teams}
          code={code}
          onClose={() => setOverride(null)}
          onDone={() => {
            setOverride(null);
            onChanged();
          }}
          onError={(msg) => flash(msg)}
        />
      )}
    </div>
  );
}

function OverrideModal({
  match,
  tournament,
  teams,
  code,
  onClose,
  onDone,
  onError,
}: {
  match: Match;
  tournament: TournamentDTO;
  teams: Map<string, Team>;
  code: string;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const h = match.home_team_id ? teams.get(match.home_team_id) : null;
  const a = match.away_team_id ? teams.get(match.away_team_id) : null;
  if (!h || !a) return null;

  async function submit(result: MatchResult) {
    setSubmitting(true);
    try {
      await api.override(tournament.id, code, match.id, result);
      onDone();
    } catch (e) {
      onError(e instanceof ApiError && e.status === 403 ? no.control.wrongOrganiserCode : no.common.error);
      setSubmitting(false);
    }
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="card card-pad modal stack" onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <h2 style={{ fontSize: "1.2rem" }}>{no.control.override}</h2>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <ResultInput
          scoring={tournament.scoring}
          home={h}
          away={a}
          initial={match.result}
          onSubmit={submit}
          submitting={submitting}
        />
      </div>
    </div>
  );
}
