"use client";

import { useEffect, useRef, useState } from "react";
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
  controlCode,
  mode = "new",
  onClose,
  onDone,
  onConflict,
  onAuthError,
}: {
  match: Match;
  tournament: TournamentDTO;
  teams: Map<string, Team>;
  deviceId: string;
  deviceName: string;
  /** Referee credential sent with every write (see lib/client/api.ts). */
  controlCode: string;
  mode?: "new" | "correct";
  onClose: () => void;
  onDone: () => void;
  onConflict: () => void;
  /** The server rejected the control code. Return true when handled (the
   * parent re-prompts), so the modal does not also report a conflict. */
  onAuthError?: (e: unknown) => boolean;
}) {
  const [version, setVersion] = useState(match.result_version);
  const [submitting, setSubmitting] = useState(false);
  const [lockedByOther, setLockedByOther] = useState<string | null>(null);
  // Live score: debounce the referee's taps, skip unchanged pushes, and stop
  // once the final result is being saved. Only for a fresh entry on a live
  // match — a self-correct of a finished match must not flip it back.
  const liveEnabled =
    mode === "new" &&
    (tournament.scoring.profile === "simple" || tournament.scoring.profile === "sets");
  const [liveState, setLiveState] = useState<"idle" | "sent" | "off">("idle");
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLive = useRef<string>("");
  const submittingRef = useRef(false);
  useEffect(
    () => () => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
    },
    [],
  );
  function pushLive(result: MatchResult) {
    if (!liveEnabled || submittingRef.current) return;
    const key = JSON.stringify(result);
    if (key === lastLive.current) return;
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => {
      liveTimer.current = null;
      if (submittingRef.current) return;
      lastLive.current = key;
      api
        .liveScore(match.id, result, { deviceId }, controlCode)
        .then(() => setLiveState("sent"))
        .catch((e) => {
          // A stale/expired code → parent re-prompts. Anything else (the match
          // finished under us, network) just stops the live feed quietly.
          if (!onAuthError?.(e)) setLiveState("off");
        });
    }, 400);
  }
  // Did OUR lock move the match scheduled → live? Only then does closing the
  // modal without a result put it back — a match started with "Start kamp"
  // stays live on the board.
  const promoted = useRef(false);

  const h = match.home_team_id ? teams.get(match.home_team_id) : null;
  const a = match.away_team_id ? teams.get(match.away_team_id) : null;
  const correcting = mode === "correct";

  // Acquire a soft lock on open; release on close (unless it became 'done').
  // In correct mode the match is already 'done' (lock would 409) — skip it.
  useEffect(() => {
    if (correcting) return;
    let active = true;
    (async () => {
      try {
        const { match: m, promoted: p } = await api.lock(match.id, deviceId, deviceName, "lock", controlCode);
        promoted.current = !!p;
        if (active) setVersion(m.result_version);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.code === "laast_av_annen") {
          // surface force-take option
          setLockedByOther("en annen enhet");
        } else if (active) {
          onAuthError?.(e);
        }
      }
    })();
    return () => {
      active = false;
      api
        .lock(match.id, deviceId, deviceName, "unlock", controlCode, { revert: promoted.current })
        .catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id]);

  // Keep the optimistic-concurrency version in step with the freshest match the
  // parent re-fetches (the modal is always rendered with the latest match). If
  // it changed under us, a submit will still correctly 409; tracking it here
  // avoids a stale-version false conflict from an unrelated refetch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror prop into guard
    setVersion(match.result_version);
  }, [match.result_version]);

  async function forceTake() {
    try {
      const { match: m, promoted: p } = await api.lock(match.id, deviceId, deviceName, "force", controlCode);
      promoted.current = !!p;
      setVersion(m.result_version);
      setLockedByOther(null);
    } catch {
      /* ignore */
    }
  }

  async function submit(result: MatchResult) {
    setSubmitting(true);
    submittingRef.current = true;
    if (liveTimer.current) {
      clearTimeout(liveTimer.current);
      liveTimer.current = null;
    }
    try {
      const device = { deviceId, deviceName };
      if (correcting) await api.correct(match.id, version, result, device, controlCode);
      else await api.submitResult(match.id, version, result, device, controlCode);
      onDone();
    } catch (e) {
      if (onAuthError?.(e)) return;
      if (e instanceof ApiError && (e.status === 409 || e.status === 403)) {
        onConflict();
        onClose();
      } else {
        setSubmitting(false);
        submittingRef.current = false;
      }
    }
  }

  if (!h || !a) return null;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="card card-pad modal stack" onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <h2 style={{ fontSize: "1.3rem" }}>
            {correcting ? no.control.edit : no.control.enterResult}
          </h2>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        {liveEnabled && liveState !== "off" && (
          <div className="live-hint" data-sent={liveState === "sent"}>
            <span className="dot" />
            {no.control.liveOnBoard}
          </div>
        )}

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
          onLive={liveEnabled ? pushLive : undefined}
        />
      </div>
    </div>
  );
}
