"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { ResultInput } from "@/lib/client/ResultInput";
import { resolve } from "@/lib/tournament/scoring";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { errorMessage } from "@/lib/locale/errors";
import { useEscape } from "@/lib/client/useEscape";
import type { Match, MatchResult, Team } from "@/lib/types";
import type { TournamentDTO } from "@/lib/dto";
import { ToolSection, type ToolsCtx } from "./shared";

const RECENT = 5;

/** «Rett et resultat»: the finished matches (latest first), each with «Endre».
 * Only the organiser code can do this — also after the referee has saved. */
export function OverrideSection({ tournament, matches, teams, code, onChanged }: ToolsCtx) {
  const [override, setOverride] = useState<Match | null>(null);
  const [all, setAll] = useState(false);
  const done = matches
    .filter((m) => m.status === "done")
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const shown = all ? done : done.slice(0, RECENT);

  return (
    <ToolSection id="override" title={no.tools.overrideTitle} intro={no.tools.overrideIntro}>
      {done.length === 0 ? (
        <p className="hint">{no.tools.overrideNone}</p>
      ) : (
        <div className="stack stack-tight">
          {shown.map((m) => {
            const h = m.home_team_id ? teams.get(m.home_team_id) : null;
            const a = m.away_team_id ? teams.get(m.away_team_id) : null;
            const r = m.result ? resolve(tournament.scoring.profile, m.result) : null;
            const homeWon = !!(m.winner_team_id && m.winner_team_id === m.home_team_id);
            const awayWon = !!(m.winner_team_id && m.winner_team_id === m.away_team_id);
            return (
              <div className="match-card match-card-static" key={m.id}>
                <div className="match-teams">
                  <span className={`team-name${homeWon ? " team-win" : ""}`}>
                    {h?.name}
                    {homeWon && <span className="win-mark"> <Icon name="check" size={14} strokeWidth={2.5} className="icon-inline" /></span>}
                  </span>
                  <span className={`team-name${awayWon ? " team-win" : ""}`}>
                    {a?.name}
                    {awayWon && <span className="win-mark"> <Icon name="check" size={14} strokeWidth={2.5} className="icon-inline" /></span>}
                  </span>
                </div>
                {/* Full scoreline (was truncated to the set tally before). */}
                <span className="match-result">{r?.display}</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!code}
                  onClick={() => setOverride(m)}
                >
                  {no.control.edit}
                </button>
              </div>
            );
          })}
          {done.length > RECENT && (
            <button type="button" className="link-btn" onClick={() => setAll((v) => !v)}>
              {all ? no.tools.showLess : no.tools.showAll(done.length)}
            </button>
          )}
        </div>
      )}

      {override && (
        <OverrideModal
          match={override}
          tournament={tournament}
          teams={teams}
          code={code}
          playoffSeeded={matches.some((m) => m.phase === "playoff")}
          onClose={() => setOverride(null)}
          onDone={() => {
            setOverride(null);
            onChanged();
          }}
        />
      )}
    </ToolSection>
  );
}

function OverrideModal({
  match,
  tournament,
  teams,
  code,
  playoffSeeded,
  onClose,
  onDone,
}: {
  match: Match;
  tournament: TournamentDTO;
  teams: Map<string, Team>;
  code: string;
  /** Sluttspillet er bygd: da endrer en seriekamp tabellen, men ikke sluttspillet. */
  playoffSeeded: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEscape(onClose);
  const h = match.home_team_id ? teams.get(match.home_team_id) : null;
  const a = match.away_team_id ? teams.get(match.away_team_id) : null;
  if (!h || !a) return null;

  async function submit(result: MatchResult) {
    setSubmitting(true);
    try {
      try {
        await api.override(tournament.id, code, match.id, result);
      } catch (e) {
        // New knockout winner after later rounds were played: say what will
        // be reset and only then resend with cascade.
        if (!(e instanceof ApiError && e.code === "neste_kamp_spilt")) throw e;
        if (!confirm(`${e.detail ?? ""} ${no.control.cascadeConfirm}`.trim())) {
          setSubmitting(false);
          return;
        }
        await api.override(tournament.id, code, match.id, result, { cascade: true });
      }
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
      setSubmitting(false);
    }
  }

  return (
    // Backdrop taps don't close (would discard the typed score); the close button / Escape do.
    <div className="scrim">
      <div
        className="card card-pad modal stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="override-modal-title"
      >
        <div className="spread">
          <h2 id="override-modal-title" className="modal-title">{no.control.override}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label={no.common.close}>
            <Icon name="close" />
          </button>
        </div>
        {err && <div className="toast-danger org-err" role="alert">{err}</div>}
        {playoffSeeded && match.phase === "league" && (
          <p className="org-warn" role="status">{no.tools.overrideAfterSeeding}</p>
        )}
        <ResultInput
          scoring={tournament.scoring}
          home={h}
          away={a}
          initial={match.result}
          knockout={match.phase === "playoff"}
          onSubmit={submit}
          submitting={submitting}
        />
      </div>
    </div>
  );
}
