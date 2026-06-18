"use client";

import { useEffect, useMemo, useState } from "react";
import { useTournament } from "@/lib/client/useTournament";
import { usePresence } from "@/lib/client/usePresence";
import { identity } from "@/lib/client/identity";
import { api } from "@/lib/client/api";
import { teamMap } from "@/lib/client/view";
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

export function ControlClient({ id }: { id: string }) {
  const { state, error, refetch } = useTournament(id);
  const [tab, setTab] = useState<Tab>("scheduled");
  const [courtId, setCourtId] = useState<string | null>(null); // filter
  const [open, setOpen] = useState<Match | null>(null);
  const [openMode, setOpenMode] = useState<"new" | "correct">("new");
  const [self, setSelf] = useState<{ deviceId: string; name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showRoster, setShowRoster] = useState(false);
  const [showStandings, setShowStandings] = useState(false);
  const [busyTimer, setBusyTimer] = useState(false);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    // Read browser-only identity/prefs after mount (hydration-safe).
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelf({ deviceId: identity.deviceId(), name: identity.deviceName() || "Enhet" });
    setCourtId(identity.pinnedCourt(id));
    setNowMs(Date.now());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [id]);

  // 1s tick drives the self-correct countdown + live timer remaining.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const devices = usePresence(id, self);
  const teams = useMemo(() => teamMap(state?.teams ?? []), [state?.teams]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
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
  if (!state)
    return <main className="center-screen"><span className="spin" /></main>;

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
      return m.status === "scheduled";
    })
    .filter((m) => !courtId || m.court_id === courtId)
    .sort((a, b) => a.queue_order - b.queue_order);

  // Next match the referee should run (respects the pinned court).
  const nextMatch = matches
    .filter(
      (m) =>
        m.status === "scheduled" &&
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
      // nowMs ticks every second; the server re-checks the window authoritatively.
      if (self && canSelfCorrect(m, self.deviceId, nowMs)) {
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
    if (!self) return;
    try {
      await api.lock(m.id, self.deviceId, self.name, "start");
      // Kick off a default 10-minute clock on the relevant court / tournament.
      await api.courtTimer(id, "start", {
        courtId: parallel ? (m.court_id ?? undefined) : undefined,
        durationSec: 600,
      });
      refetch();
    } catch {
      flash(no.common.error);
    }
  }

  // Timer target: pinned court in parallel mode, else the tournament-level clock.
  const timerCourtId = parallel && courtId ? courtId : undefined;
  const activeTimer: TimerState | null = timerCourtId
    ? (courts.find((c) => c.id === timerCourtId)?.timer ?? null)
    : (tournament.timer ?? null);
  const timerLeft =
    activeTimer?.running && activeTimer.endsAt
      ? Date.parse(activeTimer.endsAt) - nowMs
      : null;

  async function timerAction(action: "start" | "add" | "stop", durationSec?: number) {
    setBusyTimer(true);
    try {
      await api.courtTimer(id, action, { courtId: timerCourtId, durationSec });
      refetch();
    } catch {
      flash(no.common.error);
    } finally {
      setBusyTimer(false);
    }
  }

  return (
    <main className="control">
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
            {timerLeft != null ? (
              <strong className="timer-left" data-low={timerLeft < 60_000}>
                {" "}
                {fmtClock(timerLeft)}
              </strong>
            ) : null}
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
              correctMsLeft={
                m.status === "done" && self && canSelfCorrect(m, self.deviceId, nowMs)
                  ? selfCorrectMsLeft(m, nowMs)
                  : null
              }
              onTap={() => openMatch(m)}
              onStart={m.status === "scheduled" ? () => startMatch(m) : undefined}
            />
          ))
        )}
      </div>

      <div style={{ marginTop: 22 }}>
        <OrganiserPanel
          tournament={tournament}
          matches={matches}
          teams={teams}
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
          mode={openMode}
          onClose={() => setOpen(null)}
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

      {toast && <div className="toast toast-danger">{toast}</div>}
    </main>
  );
}

function MatchCard({
  m,
  teams,
  courts,
  profile,
  correctMsLeft,
  onTap,
  onStart,
}: {
  m: Match;
  teams: Map<string, Team>;
  courts: Court[];
  profile: import("@/lib/types").ScoringProfileKey;
  correctMsLeft: number | null;
  onTap: () => void;
  onStart?: () => void;
}) {
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
        ) : null}
        {court && <span>{court.name}</span>}
        {lockName && <span style={{ color: "var(--warn)" }}>{no.control.lockedBy(lockName)}</span>}
        {onStart && ready && m.status === "scheduled" && (
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
