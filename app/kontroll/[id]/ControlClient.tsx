"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "@/lib/client/OfflineBanner";
import { useTournament } from "@/lib/client/useTournament";
import { ApiError } from "@/lib/client/api";
import { errorMessage, pairErrorMessage } from "@/lib/locale/errors";
import { usePresence } from "@/lib/client/usePresence";
import { identity } from "@/lib/client/identity";
import { api, setPairToken } from "@/lib/client/api";
import { teamMap, matchTime } from "@/lib/client/view";
import { parseControlTarget, resolveControlTarget, type ControlTarget } from "@/lib/client/controlTarget";
import { resolve } from "@/lib/tournament/scoring";
import { canSelfCorrect, selfCorrectMsLeft } from "@/lib/tournament/correct";
import { no } from "@/lib/locale/no";
import type { Court, Match, Team, TimerState } from "@/lib/types";
import { ResultModal } from "./ResultModal";
import { OrganiserPanel } from "./OrganiserPanel";
import { Standings, GroupStandings } from "@/app/board/[id]/Standings";

type Tab = "scheduled" | "live" | "done";

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Event-handler clock read (kept out of the component body for react-hooks/purity). */
function wallClock(): number {
  return Date.now();
}

/** 1 s wall clock for LEAF components only. Ticking in ControlClient re-rendered
 * the whole control screen (all cards, organiser panel, modal) every second;
 * here just the tiny component that shows a countdown re-renders.
 * 0 until mounted keeps SSR/hydration identical. */
function useNow(active = true): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first client read after hydration
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function TimerLeft({ endsAt }: { endsAt: number }) {
  const now = useNow();
  if (!now) return null;
  const left = endsAt - now;
  return (
    <strong className="timer-left" data-low={left < 60_000}>
      {" "}
      {fmtClock(left)}
    </strong>
  );
}

export function ControlClient({ id }: { id: string }) {
  const { state, error, failures, lastOkAt, refetch } = useTournament(id);
  const [tab, setTab] = useState<Tab>("scheduled");
  const [courtId, setCourtId] = useState<string | null>(null); // filter
  const [open, setOpen] = useState<Match | null>(null);
  const [openMode, setOpenMode] = useState<"new" | "correct">("new");
  const [self, setSelf] = useState<{ deviceId: string; name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showRoster, setShowRoster] = useState(false);
  const [showStandings, setShowStandings] = useState(false);
  const [busyTimer, setBusyTimer] = useState(false);
  // The referee credential. undefined = not read yet (SSR/first paint); null =
  // this device never attached with the code (deep link, cleared storage, or
  // the server rejected the stored one) → the CodeGate below asks for it.
  const [ctl, setCtl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // Read browser-only identity/prefs after mount (hydration-safe).
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelf({ deviceId: identity.deviceId(), name: identity.deviceName() || "Enhet" });
    setCourtId(identity.pinnedCourt(id));
    setCtl(identity.controlCode(id));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [id]);

  // Mål fra kampkort/banekort-QR (?match= / ?court=), lest én gang og brukt når
  // tilstanden er lastet og enheten er koblet til.
  const target = useRef<ControlTarget | null>(null);
  useEffect(() => {
    target.current = parseControlTarget(window.location.search);
  }, []);
  useEffect(() => {
    const t = target.current;
    if (!t || !state || !ctl) return;
    target.current = null;
    const action = resolveControlTarget(t, state.matches, state.courts);
    if (!action) return;
    if (action.kind === "pinCourt") {
      setCourtId(action.courtId);
      identity.setPinnedCourt(id, action.courtId);
    } else if (action.kind === "openMatch") {
      setTab("scheduled");
      setOpenMode("new");
      setOpen(action.match);
    } else {
      flash(
        action.kind === "matchDone"
          ? no.control.targetDone
          : action.kind === "matchNotReady"
            ? no.control.targetNotReady
            : no.control.targetMissing,
      );
    }
  }, [state, ctl, id]);

  // Pairing token: makes this phone immune to the shared-IP wrong-code block.
  // Phones paired before tokens existed (or paired some other way) have a code
  // but no token → attach once, silently, to obtain it.
  useEffect(() => {
    if (!ctl) return;
    const tok = identity.pairToken(id);
    if (tok) {
      setPairToken(ctl, tok);
      return;
    }
    api.attachControl(ctl).catch(() => {});
  }, [ctl, id]);

  /** The server said the stored control code is wrong → forget it and re-ask.
   * Returns true when the error was exactly that, so callers can skip their
   * generic toast. */
  function codeRejected(e: unknown): boolean {
    if (e instanceof ApiError && e.status === 403 && e.code === "feil_kontrollkode") {
      identity.setControlCode(id, null);
      setCtl(null);
      setOpen(null);
      flash(no.control.codeRejected);
      return true;
    }
    return false;
  }

  const devices = usePresence(id, self);
  const teams = useMemo(() => teamMap(state?.teams ?? []), [state?.teams]);

  // One pending hide-timer: a new toast replaces (and restarts) the previous
  // one instead of the older timeout hiding the newer message early, and an
  // unmount never fires setState on a dead component.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  function flash(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, 2600);
  }

  if (error && !state)
    return (
      <main className="center-screen">
        <div className="stack center">
          <div className="empty">{no.common.error}</div>
          <button className="btn" onClick={refetch}>{no.common.retry}</button>
        </div>
      </main>
    );
  if (!state || ctl === undefined)
    return <main className="center-screen"><span className="spin" /></main>;
  if (ctl === null)
    return (
      <CodeGate
        tournamentId={id}
        title={state.tournament.title}
        onAttached={(code) => {
          identity.setControlCode(id, code);
          setCtl(code);
        }}
      />
    );

  const { tournament, matches, courts, standings, groupStandings } = state;
  const parallel = tournament.parallelism === "parallel";
  const showDraw =
    tournament.scoring.profile === "simple" && tournament.scoring.allowDraw;
  const hasStandings =
    (groupStandings?.some((g) => g.rows.length > 0) ?? false) ||
    standings.length > 0;

  const filtered = matches
    .filter((m) => {
      if (m.status === "bye") return false;
      if (tab === "live") return m.status === "live";
      if (tab === "done") return m.status === "done";
      return m.status === "scheduled" || m.status === "called";
    })
    .filter((m) => !courtId || m.court_id === courtId)
    .sort((a, b) => a.queue_order - b.queue_order);

  // Next match the referee should run (respects the pinned court).
  const nextMatch = matches
    .filter(
      (m) =>
        (m.status === "scheduled" || m.status === "called") &&
        m.home_team_id &&
        m.away_team_id &&
        (!courtId || m.court_id === courtId),
    )
    .sort((a, b) => a.queue_order - b.queue_order)[0];

  function pin(cId: string | null) {
    setCourtId(cId);
    identity.setPinnedCourt(id, cId);
  }

  function openMatch(m: Match) {
    if (m.status === "done") {
      // Read the clock at tap time (no per-second state in this component);
      // the server re-checks the window authoritatively.
      if (self && canSelfCorrect(m, self.deviceId, wallClock())) {
        setOpenMode("correct");
        setOpen(m);
      } else {
        flash(no.control.editWindowGone);
      }
      return;
    }
    setOpenMode("new");
    setOpen(m);
  }

  async function startMatch(m: Match) {
    if (!self || !ctl) return;
    try {
      await api.lock(m.id, self.deviceId, self.name, "start", ctl);
      // Kick off a default 10-minute clock on the relevant court / tournament.
      await api.courtTimer(id, "start", ctl, {
        courtId: parallel ? (m.court_id ?? undefined) : undefined,
        durationSec: 600,
      });
      refetch();
    } catch (e) {
      if (!codeRejected(e)) flash(errorMessage(e));
    }
  }

  // Timer target: pinned court in parallel mode, else the tournament-level clock.
  const timerCourtId = parallel && courtId ? courtId : undefined;
  const activeTimer: TimerState | null = timerCourtId
    ? (courts.find((c) => c.id === timerCourtId)?.timer ?? null)
    : (tournament.timer ?? null);
  const timerEndsAt =
    activeTimer?.running && activeTimer.endsAt ? Date.parse(activeTimer.endsAt) : null;

  async function timerAction(action: "start" | "add" | "stop", durationSec?: number) {
    if (!ctl) return;
    setBusyTimer(true);
    try {
      await api.courtTimer(id, action, ctl, { courtId: timerCourtId, durationSec });
      refetch();
    } catch (e) {
      if (!codeRejected(e)) flash(errorMessage(e));
    } finally {
      setBusyTimer(false);
    }
  }

  return (
    <main className="control">
      <OfflineBanner failures={failures} lastOkAt={lastOkAt} />
      <div className="control-head stack" style={{ gap: 10 }}>
        <div className="spread">
          <span className="brand" style={{ fontSize: ".95rem" }}>
            <span className="brand-mark" style={{ width: 26, height: 26, fontSize: ".8rem" }}>T</span>
            {tournament.title || no.brand}
          </span>
          <div className="row" style={{ gap: 8 }}>
            {hasStandings && (
              <button
                className="pill"
                data-on={showStandings}
                onClick={() => setShowStandings((v) => !v)}
              >
                {no.board.standings}
              </button>
            )}
            <button className="pill" onClick={() => setShowRoster((v) => !v)}>
              {devices.length} {no.pair.attached}
            </button>
          </div>
        </div>

        {showRoster && devices.length > 0 && (
          <div className="roster">
            {devices.map((d) => (
              <span key={d.deviceId} className="roster-chip">
                <span className="dot" />
                {d.name}
                {self && d.deviceId === self.deviceId ? " (deg)" : ""}
              </span>
            ))}
          </div>
        )}

        {showStandings && hasStandings && (
          <div className="control-standings">
            {groupStandings && groupStandings.length > 0 ? (
              <GroupStandings
                groups={groupStandings}
                teams={teams}
                showDraw={showDraw}
                compact
              />
            ) : (
              <Standings
                standings={standings}
                teams={teams}
                showDraw={showDraw}
                compact
              />
            )}
          </div>
        )}

        <div className="tabs">
          {(["scheduled", "live", "done"] as Tab[]).map((t) => (
            <button key={t} className="tab" data-on={tab === t} onClick={() => setTab(t)}>
              {t === "scheduled" ? no.control.scheduled : t === "live" ? no.control.live : no.control.done}
            </button>
          ))}
        </div>

        {parallel && courts.length > 0 && (
          <div className="chips">
            <button className="chip" data-on={!courtId} onClick={() => pin(null)}>
              {no.control.allCourts}
            </button>
            {courts.map((c) => (
              <button key={c.id} className="chip" data-on={courtId === c.id} onClick={() => pin(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Referee match timer (per-court in parallel, tournament-level otherwise). */}
        <div className="timer-bar">
          <span className="timer-label">
            {no.control.matchTimer}
            {timerEndsAt != null ? <TimerLeft endsAt={timerEndsAt} /> : null}
          </span>
          <div className="btn-row" style={{ gap: 6 }}>
            {[5, 8, 10].map((min) => (
              <button
                key={min}
                className="btn btn-sm"
                disabled={busyTimer}
                onClick={() => timerAction("start", min * 60)}
              >
                {min}m
              </button>
            ))}
            <button className="btn btn-sm btn-ghost" disabled={busyTimer} onClick={() => timerAction("add")}>
              +1
            </button>
            <button className="btn btn-sm btn-ghost" disabled={busyTimer} onClick={() => timerAction("stop")}>
              {no.control.timerStop}
            </button>
          </div>
        </div>

        {nextMatch && tab !== "done" && (
          <div className="next-hint">
            {no.control.nextMatch}:{" "}
            <strong>
              {teams.get(nextMatch.home_team_id!)?.name} {no.common.vs}{" "}
              {teams.get(nextMatch.away_team_id!)?.name}
            </strong>
            {parallel && nextMatch.court_id
              ? ` · ${courts.find((c) => c.id === nextMatch.court_id)?.name ?? ""}`
              : ""}
          </div>
        )}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        {filtered.length === 0 ? (
          <div className="empty">{no.board.noMatches}</div>
        ) : (
          filtered.map((m) => (
            <MatchCard
              key={m.id}
              m={m}
              teams={teams}
              courts={courts}
              profile={tournament.scoring.profile}
              selfDeviceId={self?.deviceId ?? null}
              onTap={() => openMatch(m)}
              onStart={m.status === "scheduled" || m.status === "called" ? () => startMatch(m) : undefined}
            />
          ))
        )}
      </div>

      <div style={{ marginTop: 22 }}>
        <OrganiserPanel
          tournament={tournament}
          matches={matches}
          teams={teams}
          courts={courts}
          onChanged={refetch}
          flash={flash}
        />
      </div>

      {open && (
        <ResultModal
          match={
            // always render the freshest copy of the match
            matches.find((x) => x.id === open.id) ?? open
          }
          tournament={tournament}
          teams={teams}
          deviceId={self?.deviceId ?? "anon"}
          deviceName={self?.name ?? "Enhet"}
          controlCode={ctl}
          mode={openMode}
          onClose={() => setOpen(null)}
          onAuthError={codeRejected}
          onDone={() => {
            setOpen(null);
            refetch();
          }}
          onConflict={() => {
            flash(openMode === "correct" ? no.control.editWindowGone : no.control.conflict);
            refetch();
          }}
        />
      )}

      {/* Always mounted so the live region exists before the text lands —
          screen readers announce content changes, not freshly inserted regions. */}
      <div role="status" aria-live="polite" className={toast ? "toast toast-danger" : undefined}>
        {toast}
      </div>
    </main>
  );
}

/** Inline re-attach: /kontroll/[id] was opened without the control code on
 * this device (deep link, cleared storage, or a rejected code). Same six-digit
 * entry as /kontroll, but pinned to THIS tournament — a code for a different
 * tournament is refused rather than silently navigating away. */
function CodeGate({
  tournamentId,
  title,
  onAttached,
}: {
  tournamentId: string;
  title: string;
  onAttached: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function attach() {
    setBusy(true);
    setErr(null);
    try {
      const { tournament } = await api.attachControl(code);
      if (tournament.id !== tournamentId) {
        setErr(no.pair.codeForOther);
        return;
      }
      onAttached(code);
    } catch (e) {
      setErr(pairErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-screen">
      <div className="card card-pad stack" style={{ maxWidth: 420, width: "100%" }}>
        <div className="brand" style={{ justifyContent: "center" }}>
          <span className="brand-mark">T</span>
          {title || no.brand}
        </div>
        <h2 className="center">{no.pair.reenterTitle}</h2>
        <p className="faint center" style={{ fontSize: ".9rem" }}>{no.pair.reenterHint}</p>
        <input
          className="input code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && code.length === 6 && attach()}
        />
        {err && <div className="toast-danger" style={{ fontSize: ".9rem" }}>{err}</div>}
        <button
          className="btn btn-gold btn-block btn-lg"
          disabled={busy || code.length !== 6}
          onClick={attach}
        >
          {busy ? <span className="spin" /> : null}
          {busy ? no.pair.joining : no.pair.join}
        </button>
      </div>
    </main>
  );
}

function MatchCard({
  m,
  teams,
  courts,
  profile,
  selfDeviceId,
  onTap,
  onStart,
}: {
  m: Match;
  teams: Map<string, Team>;
  courts: Court[];
  profile: import("@/lib/types").ScoringProfileKey;
  selfDeviceId: string | null;
  onTap: () => void;
  onStart?: () => void;
}) {
  // Only finished cards run the self-correct countdown clock.
  const now = useNow(m.status === "done" && !!selfDeviceId);
  const correctMsLeft =
    now && selfDeviceId && canSelfCorrect(m, selfDeviceId, now)
      ? selfCorrectMsLeft(m, now)
      : null;
  const h = m.home_team_id ? teams.get(m.home_team_id) : null;
  const a = m.away_team_id ? teams.get(m.away_team_id) : null;
  const court = courts.find((c) => c.id === m.court_id);
  const locked = m.locked_by && m.status !== "done";
  const lockName = locked ? m.locked_by!.split("|")[1] : null;
  const r = m.result ? resolve(profile, m.result) : null;
  const ready = h && a;
  const tappable = (ready && m.status !== "done") || correctMsLeft != null;
  const homeWon = !!(m.winner_team_id && m.winner_team_id === m.home_team_id);
  const awayWon = !!(m.winner_team_id && m.winner_team_id === m.away_team_id);

  return (
    <div
      className="match-card"
      data-locked={!!locked}
      data-disabled={!tappable}
      role="button"
      tabIndex={tappable ? 0 : -1}
      onClick={tappable ? onTap : undefined}
      onKeyDown={(e) => {
        if (tappable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onTap();
        }
      }}
    >
      <div className="match-teams">
        {m.status !== "done" && matchTime(m.scheduled_at) && (
          <span className="match-time">{matchTime(m.scheduled_at)}</span>
        )}
        <TeamLine team={h} win={m.status === "done" && homeWon} />
        <TeamLine team={a} win={m.status === "done" && awayWon} />
      </div>
      <div className="match-meta stack" style={{ gap: 4, alignItems: "flex-end" }}>
        {m.status === "done" && r ? (
          // Full scoreline (e.g. "2–1 (25–20, 23–25, 15–10)") — no longer
          // truncated to the set tally, so judges see exactly what was entered.
          <span className="match-result">{r.display}</span>
        ) : m.status === "live" ? (
          <span className="pill pill-live"><span className="dot" />{no.control.live}</span>
        ) : m.status === "called" ? (
          <span className="pill pill-called">{court ? no.control.calledTo(court.name) : no.board.calledUp}</span>
        ) : null}
        {court && <span>{court.name}</span>}
        {lockName && <span style={{ color: "var(--warn)" }}>{no.control.lockedBy(lockName)}</span>}
        {onStart && ready && (m.status === "scheduled" || m.status === "called") && (
          <button
            className="btn btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              onStart();
            }}
          >
            {no.control.startMatch}
          </button>
        )}
        {correctMsLeft != null && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={(e) => {
              e.stopPropagation();
              onTap();
            }}
          >
            {no.control.editJustSaved} ({fmtClock(correctMsLeft)})
          </button>
        )}
      </div>
    </div>
  );
}

function TeamLine({
  team,
  win = false,
}: {
  team: Team | null | undefined;
  win?: boolean;
}) {
  return (
    <span className={`team${win ? " team-win" : ""}`}>
      <span className="team-swatch" style={{ background: team?.colour ?? "#555" }} />
      <span className="team-name">{team?.name ?? no.board.tbd}</span>
      {win && <span className="win-mark" aria-label="Vinner" title="Vinner">✓</span>}
    </span>
  );
}
