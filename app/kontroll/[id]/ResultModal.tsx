"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { ResultInput } from "@/lib/client/ResultInput";
import { no } from "@/lib/locale/no";
import type { Match, MatchResult, Team } from "@/lib/types";
import type { TournamentDTO } from "@/lib/dto";

export function ResultModal({
  match,
  tournament,
  teams,
  deviceId,
  deviceName,
  onClose,
  onDone,
  onConflict,
}: {
  match: Match;
  tournament: TournamentDTO;
  teams: Map<string, Team>;
  deviceId: string;
  deviceName: string;
  onClose: () => void;
  onDone: () => void;
  onConflict: () => void;
}) {
  const [version, setVersion] = useState(match.result_version);
  const [submitting, setSubmitting] = useState(false);
  const [lockedByOther, setLockedByOther] = useState<string | null>(null);

  const h = match.home_team_id ? teams.get(match.home_team_id) : null;
  const a = match.away_team_id ? teams.get(match.away_team_id) : null;

  // Acquire a soft lock on open; release on close (unless it became 'done').
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { match: m } = await api.lock(match.id, deviceId, deviceName, "lock");
        if (active) setVersion(m.result_version);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.code === "laast_av_annen") {
          // surface force-take option
          setLockedByOther("en annen enhet");
        }
      }
    })();
    return () => {
      active = false;
      api.lock(match.id, deviceId, deviceName, "unlock").catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id]);

  async function forceTake() {
    try {
      const { match: m } = await api.lock(match.id, deviceId, deviceName, "force");
      setVersion(m.result_version);
      setLockedByOther(null);
    } catch {
      /* ignore */
    }
  }

  async function submit(result: MatchResult) {
    setSubmitting(true);
    try {
      await api.submitResult(match.id, version, result);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        onConflict();
        onClose();
      } else {
        setSubmitting(false);
      }
    }
  }

  if (!h || !a) return null;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="card card-pad modal stack" onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <h2 style={{ fontSize: "1.3rem" }}>{no.control.enterResult}</h2>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>

        {lockedByOther && (
          <div className="panel" style={{ borderColor: "rgba(224,137,74,.4)" }}>
            <div className="spread">
              <span className="muted">{no.control.lockedBy(lockedByOther)}</span>
              <button className="btn btn-ghost" onClick={forceTake}>
                {no.control.forceTake}
              </button>
            </div>
          </div>
        )}

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
