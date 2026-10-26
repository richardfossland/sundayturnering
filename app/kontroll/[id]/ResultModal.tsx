"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { submitResultOrQueue } from "@/lib/client/outbox";
import { ResultInput } from "@/lib/client/ResultInput";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { identity } from "@/lib/client/identity";
import { pairingOf, teamsChangedSince, versionToSend } from "@/lib/client/resultStale";
import { errorMessage } from "@/lib/locale/errors";
import { useEscape } from "@/lib/client/useEscape";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import type { Match, MatchResult, Team, TimerState } from "@/lib/types";
import type { TournamentDTO } from "@/lib/dto";
import { MatchTimer } from "./MatchTimer";

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
  onQueued,
  onConflict,
  onAuthError,
  subtitle,
  timer,
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
  /** Saved on the server (not queued): the parent confirms with a toast.
   * `propagated:false` = the result is saved but the next bracket match was not
   * updated — the parent warns the referee. */
  onDone: (result: MatchResult, info: { propagated: boolean }) => void;
  /** The result could not be sent (no network) and sits in the phone's outbox. */
  onQueued?: () => void;
  onConflict: () => void;
  /** The server rejected the control code. Return true when handled (the
   * parent re-prompts), so the modal does not also report a conflict. */
  onAuthError?: (e: unknown) => boolean;
  /** «07:15 · Bane 1» under the title. */
  subtitle?: string;
  /** The referee countdown for this match's court (new results only). */
  timer?: {
    state: TimerState | null;
    perCourt: boolean;
    busy: boolean;
    onAction: (action: "start" | "add" | "stop", durationSec?: number) => void;
  };
}) {
  const [version, setVersion] = useState(match.result_version);
  // The pairing this modal was opened for (C7): a score typed here belongs to
  // THESE teams. If an override/swap changes them while the modal is open, the
  // new version is NOT adopted and «Lagre» is refused (see below).
  const [openedFor] = useState(() => pairingOf(match));
  const teamsChanged = teamsChangedSince(openedFor, match);
  const [submitting, setSubmitting] = useState(false);
  const [lockedByOther, setLockedByOther] = useState<string | null>(null);
  // Server/network failure shown in the modal (was silently swallowed, so a
  // 422 detail or "tournament finished" never reached the referee).
  const [err, setErr] = useState<string | null>(null);
  useEscape(onClose);
  const dialogRef = useFocusTrap<HTMLDivElement>("dialog");
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
          setLockedByOther(no.control.otherDevice);
        } else if (active && !onAuthError?.(e)) {
          setErr(errorMessage(e));
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
  // parent re-fetches (the modal is always rendered with the latest match);
  // this avoids a false conflict from an unrelated refetch. NOT when the teams
  // changed: adopting that version would make the server accept a score typed
  // for the old pairing (the migration 0020 trigger bumps the version exactly
  // then), so the version stays and «Lagre» is refused instead.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror prop into guard
    setVersion((cur) => versionToSend(cur, match.result_version, teamsChanged));
  }, [match.result_version, teamsChanged]);

  async function forceTake() {
    try {
      const { match: m, promoted: p } = await api.lock(match.id, deviceId, deviceName, "force", controlCode);
      promoted.current = !!p;
      setVersion(m.result_version);
      setLockedByOther(null);
      setErr(null);
    } catch (e) {
      if (!onAuthError?.(e)) setErr(errorMessage(e));
    }
  }

  async function submit(result: MatchResult) {
    if (teamsChanged) {
      setErr(no.control.matchTeamsChanged);
      return;
    }
    setSubmitting(true);
    submittingRef.current = true;
    if (liveTimer.current) {
      clearTimeout(liveTimer.current);
      liveTimer.current = null;
    }
    setErr(null);
    try {
      // deviceSecret: the private half of this phone's identity — what lets it
      // (and only it) use «Endre» on this result afterwards.
      const device = { deviceId, deviceName, deviceSecret: identity.deviceSecret() };
      let propagated = true;
      if (correcting) {
        const r = await api.correct(match.id, version, result, device, controlCode);
        propagated = r.propagated !== false;
        identity.markOwned(match.id, r.match.result_version);
      } else {
        const r = await submitResultOrQueue({
          tournamentId: tournament.id,
          matchId: match.id,
          expectedVersion: version,
          result,
          device,
          controlCode,
        });
        if (r.queued) {
          onQueued?.();
          onClose();
          return;
        }
        propagated = r.propagated;
        identity.markOwned(match.id, r.match.result_version);
      }
      if (!propagated)
        console.warn("[result] saved, but the bracket was not updated for match", match.id);
      onDone(result, { propagated });
    } catch (e) {
      if (onAuthError?.(e)) return;
      // Someone else changed/finished it → the parent refetches and warns.
      if (e instanceof ApiError && (e.code === "konflikt" || e.code === "kamp_ferdig")) {
        onConflict();
        onClose();
        return;
      }
      // Everything else stays in the modal with a real message, and the
      // typed score is kept so the referee can fix it and retry.
      setErr(errorMessage(e));
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  if (!h || !a) return null;

  return (
    // No close on a backdrop tap: a stray tap on a phone used to throw away
    // the score being typed. The close button or Escape closes.
    <div className="scrim scrim-sheet">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="card sheet score-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-modal-title"
      >
        <div className="sheet-head">
          <div className="sheet-heading">
            <h2 id="result-modal-title" className="sheet-title">
              {correcting ? no.control.edit : no.control.enterResult}
            </h2>
            {subtitle && <span className="sheet-sub">{subtitle}</span>}
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label={no.common.close}>
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body stack stack-tight">
          {(teamsChanged || err) && (
            <div className="toast-danger" role="alert">
              {teamsChanged ? no.control.matchTeamsChanged : err}
            </div>
          )}
          {liveEnabled && liveState !== "off" && (
            <div className="live-hint" data-sent={liveState === "sent"}>
              <span className="dot" />
              {no.control.liveOnBoard}
            </div>
          )}

          {lockedByOther && (
            <div className="panel lock-panel">
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
            knockout={match.phase === "playoff"}
            onSubmit={submit}
            submitting={submitting}
            onLive={liveEnabled ? pushLive : undefined}
            aside={
              timer && !correcting ? (
                <MatchTimer
                  timer={timer.state}
                  perCourt={timer.perCourt}
                  busy={timer.busy}
                  onAction={timer.onAction}
                />
              ) : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
