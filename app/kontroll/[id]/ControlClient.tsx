"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "@/lib/client/OfflineBanner";
import { useTournament } from "@/lib/client/useTournament";
import { useOutbox, type OutboxEvent } from "@/lib/client/outbox";
import { ApiError } from "@/lib/client/api";
import { errorMessage, pairErrorMessage } from "@/lib/locale/errors";
import { usePresence } from "@/lib/client/usePresence";
import { identity } from "@/lib/client/identity";
import { api, setPairToken } from "@/lib/client/api";
import { teamMap, matchTime } from "@/lib/client/view";
import { parseControlTarget, resolveControlTarget, type ControlTarget } from "@/lib/client/controlTarget";
import { resolve } from "@/lib/tournament/scoring";
import { canSelfCorrect } from "@/lib/tournament/correct";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { useToast } from "@/lib/client/useToast";
import type { Match, MatchResult, TimerState } from "@/lib/types";
import { ResultModal } from "./ResultModal";
import { OrganiserPanel } from "./OrganiserPanel";
import { MatchCard } from "./MatchCard";
import { isPlayable } from "@/lib/tournament/courts";
import { StandingsSheet } from "./StandingsSheet";
import { wallClock } from "./clock";

/** The three match lists, plus the organiser tools as a tab of their own. */
type Tab = "scheduled" | "live" | "done" | "org";

/** How long a just-saved match stays at the top of the list, highlighted, so
 * the referee SEES it was saved before it settles into «Ferdig». */
const SAVED_VISIBLE_MS = 6000;

export function ControlClient({ id }: { id: string }) {
  const { state, error, failures, lastOkAt, refetch } = useTournament(id);
  const [tab, setTab] = useState<Tab>("scheduled");
  const [courtId, setCourtId] = useState<string | null>(null); // filter
  const [open, setOpen] = useState<Match | null>(null);
  const [openMode, setOpenMode] = useState<"new" | "correct">("new");
  const [self, setSelf] = useState<{ deviceId: string; name: string } | null>(null);
  const { flash, region: toastRegion } = useToast();
  const [showRoster, setShowRoster] = useState(false);
  const [showStandings, setShowStandings] = useState(false);
  const [busyTimer, setBusyTimer] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Matches whose «Start kamp» is in flight (a second tap must not start twice).
  const [startingIds, setStartingIds] = useState<ReadonlySet<string>>(new Set());
  // The referee credential. undefined = not read yet (SSR/first paint); null =
  // this device never attached with the code (deep link, cleared storage, or
  // the server rejected the stored one) → the CodeGate below asks for it.
  const [ctl, setCtl] = useState<string | null | undefined>(undefined);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

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
        "error",
      );
    }
  }, [state, ctl, id, flash]);

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
      flash(no.control.codeRejected, "error");
      return true;
    }
    return false;
  }

  /** Hold a just-saved match on top of the list for a few seconds. */
  const holdSaved = useCallback((matchId: string) => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSavedId(matchId);
    savedTimer.current = setTimeout(() => {
      savedTimer.current = null;
      setSavedId(null);
    }, SAVED_VISIBLE_MS);
  }, []);

  // Results queued on this phone while the net was down (lib/client/outbox.ts).
  const onOutbox = useCallback(
    (e: OutboxEvent) => {
      if (e.type === "sent") {
        flash(no.control.unsentSent, "success");
        holdSaved(e.entry.matchId);
      } else if (!codeRejected(e.error)) {
        flash(e.error.code === "konflikt" ? no.control.unsentRejected : errorMessage(e.error), "error");
      }
      refetch();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refetch, id, holdSaved],
  );
  const { entries: unsent, flush: flushOutbox, dismiss: dismissOutbox } = useOutbox(id, onOutbox);
  const unsentPending = useMemo(() => unsent.filter((e) => !e.failed), [unsent]);
  const unsentByMatch = useMemo(() => new Map(unsent.map((e) => [e.matchId, e])), [unsent]);
  const [retrying, setRetrying] = useState(false);

  const devices = usePresence(id, self);
  const teams = useMemo(() => teamMap(state?.teams ?? []), [state?.teams]);

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

  const onCourt = (m: Match) => !courtId || m.court_id === courtId;
  const isPlanned = (m: Match) => m.status === "scheduled" || m.status === "called";
  const byOrder = (a: Match, b: Match) => a.queue_order - b.queue_order;
  const counts = {
    scheduled: matches.filter((m) => isPlanned(m) && onCourt(m)).length,
    live: matches.filter((m) => m.status === "live" && onCourt(m)).length,
    done: matches.filter((m) => m.status === "done" && onCourt(m)).length,
  };

  // Next match the referee should run (respects the pinned court).
  const nextMatch = matches
    .filter(
      (m) =>
        isPlanned(m) &&
        m.home_team_id &&
        m.away_team_id &&
        isPlayable(m, tournament.status) &&
        onCourt(m),
    )
    .sort(byOrder)[0];

  // A match saved a moment ago stays on top of whichever list is open.
  const savedMatch = savedId ? matches.find((m) => m.id === savedId && m.status === "done") : undefined;

  const filtered = matches
    .filter((m) => {
      if (m.status === "bye") return false;
      if (tab === "live") return m.status === "live";
      if (tab === "done") return m.status === "done";
      return isPlanned(m);
    })
    .filter(onCourt)
    .sort(byOrder);
  // «Din neste kamp» is the first card of the planned list, not header text.
  const highlightNext = tab === "scheduled" && nextMatch ? nextMatch : null;
  const listed: { m: Match; flag: "next" | "saved" | null }[] = [
    ...(savedMatch ? [{ m: savedMatch, flag: "saved" as const }] : []),
    ...(highlightNext ? [{ m: highlightNext, flag: "next" as const }] : []),
    ...filtered
      .filter((m) => m.id !== highlightNext?.id && m.id !== savedMatch?.id)
      .map((m) => ({ m, flag: null })),
  ];

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
        flash(no.control.editWindowGone, "error");
      }
      return;
    }
    setOpenMode("new");
    setOpen(m);
  }

  async function startMatch(m: Match) {
    if (!self || !ctl || startingIds.has(m.id)) return;
    setStartingIds((prev) => new Set(prev).add(m.id));
    try {
      await api.lock(m.id, self.deviceId, self.name, "start", ctl);
      // Kick off a default 10-minute clock on the relevant court / tournament.
      await api.courtTimer(id, "start", ctl, {
        courtId: parallel ? (m.court_id ?? undefined) : undefined,
        durationSec: 600,
      });
      refetch();
      // The match now lives under «Spilles»: take the referee there, where the
      // card offers «Før resultat».
      setTab("live");
      flash(no.control.started, "success");
    } catch (e) {
      if (!codeRejected(e)) flash(errorMessage(e), "error");
    } finally {
      setStartingIds((prev) => {
        const next = new Set(prev);
        next.delete(m.id);
        return next;
      });
    }
  }

  // The countdown that belongs to a match: its court in a parallel tournament,
  // the tournament-level clock otherwise.
  function timerFor(m: Match): TimerState | null {
    return parallel && m.court_id
      ? (courts.find((c) => c.id === m.court_id)?.timer ?? null)
      : (tournament.timer ?? null);
  }
  function timerEndsAtFor(m: Match): number | null {
    const t = timerFor(m);
    return t?.running && t.endsAt ? Date.parse(t.endsAt) : null;
  }

  async function timerAction(
    m: Match,
    action: "start" | "add" | "stop",
    durationSec?: number,
  ) {
    if (!ctl) return;
    setBusyTimer(true);
    try {
      await api.courtTimer(id, action, ctl, {
        courtId: parallel ? (m.court_id ?? undefined) : undefined,
        durationSec,
      });
      refetch();
    } catch (e) {
      if (!codeRejected(e)) flash(errorMessage(e), "error");
    } finally {
      setBusyTimer(false);
    }
  }

  /** «Lagret: Lag 1 2–1 Lag 8» + the card held on top for a few seconds. */
  function confirmSaved(m: Match, result: MatchResult) {
    const h = m.home_team_id ? teams.get(m.home_team_id)?.name : null;
    const a = m.away_team_id ? teams.get(m.away_team_id)?.name : null;
    flash(
      no.control.savedMatch(h ?? no.board.tbd, resolve(tournament.scoring.profile, result).display, a ?? no.board.tbd),
      "success",
    );
    holdSaved(m.id);
  }

  const openMatchNow = open ? (matches.find((x) => x.id === open.id) ?? open) : null;
  const openCourt = openMatchNow ? courts.find((c) => c.id === openMatchNow.court_id) : null;
  const openTime = openMatchNow ? matchTime(openMatchNow.scheduled_at) : null;
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "scheduled", label: no.control.scheduled, count: counts.scheduled },
    { key: "live", label: no.control.live, count: counts.live },
    { key: "done", label: no.control.done, count: counts.done },
  ];

  return (
    <main className="control">
      <OfflineBanner failures={failures} lastOkAt={lastOkAt} />
      <header className="ctl-top">
        {unsentPending.length > 0 && (
          <div className="unsent-bar" role="status" aria-live="polite">
            <span>{no.control.unsentBadge(unsentPending.length)}</span>
            <button
              className="btn btn-sm"
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                flushOutbox();
                setTimeout(() => setRetrying(false), 1500);
              }}
            >
              {retrying ? no.control.unsentRetrying : no.control.unsentRetry}
            </button>
          </div>
        )}
        <div className="ctl-bar">
          <span className="brand ctl-title">
            <span className="brand-mark">T</span>
            <span className="ctl-title-text">{tournament.title || no.brand}</span>
          </span>
          <button
            type="button"
            className="ctl-conn"
            data-offline={failures >= 2}
            aria-expanded={showRoster}
            aria-label={failures >= 2 ? `${no.control.offline}. ${no.control.connection(devices.length)}` : no.control.connection(devices.length)}
            onClick={() => setShowRoster((v) => !v)}
          >
            <span className="ctl-conn-dot" />
            {devices.length}
          </button>
          {hasStandings && (
            <button type="button" className="btn ctl-standings" onClick={() => setShowStandings(true)}>
              <Icon name="standings" size={18} />
              {no.board.standings}
            </button>
          )}
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

        <div className="ctl-tabs" role="tablist" aria-label={no.control.matches}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              className="ctl-tab"
              aria-selected={tab === t.key}
              data-on={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              <span className="ctl-count">{t.count}</span>
            </button>
          ))}
          <button
            type="button"
            role="tab"
            className="ctl-tab ctl-tab-org"
            aria-selected={tab === "org"}
            data-on={tab === "org"}
            onClick={() => setTab("org")}
          >
            <Icon name="settings" size={16} />
            {no.control.organiser}
          </button>
        </div>
      </header>

      {tab === "org" ? (
        <section className="ctl-org" role="tabpanel" aria-label={no.control.organiser}>
          <OrganiserPanel
            tournament={tournament}
            matches={matches}
            teams={teams}
            courts={courts}
            onChanged={refetch}
            flash={flash}
          />
        </section>
      ) : (
        <section className="ctl-list" role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label}>
          {parallel && courts.length > 0 && (
            <label className="court-pick">
              <span className="court-pick-label">{no.control.chooseCourt}</span>
              <select
                className="select"
                value={courtId ?? ""}
                onChange={(e) => pin(e.target.value || null)}
              >
                <option value="">{no.control.allCourts}</option>
                {courts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {listed.length === 0 ? (
            <div className="empty">{no.board.noMatches}</div>
          ) : (
            listed.map(({ m, flag }) => (
              <MatchCard
                key={m.id}
                m={m}
                teams={teams}
                courts={courts}
                profile={tournament.scoring.profile}
                selfDeviceId={self?.deviceId ?? null}
                unsent={unsentByMatch.get(m.id) ?? null}
                timerEndsAt={m.status === "live" ? timerEndsAtFor(m) : null}
                flag={flag}
                closed={!isPlayable(m, tournament.status)}
                starting={startingIds.has(m.id)}
                onDismissUnsent={dismissOutbox}
                onEnterScore={() => openMatch(m)}
                onCorrect={() => openMatch(m)}
                onStart={() => startMatch(m)}
                onLocked={() => openMatch(m)}
              />
            ))
          )}
        </section>
      )}

      {open && openMatchNow && (
        <ResultModal
          // always render the freshest copy of the match
          match={openMatchNow}
          tournament={tournament}
          teams={teams}
          deviceId={self?.deviceId ?? "anon"}
          deviceName={self?.name ?? "Enhet"}
          controlCode={ctl}
          mode={openMode}
          subtitle={[openTime, openCourt?.name].filter(Boolean).join(" · ") || undefined}
          timer={{
            state: timerFor(openMatchNow),
            perCourt: parallel && !!openMatchNow.court_id,
            busy: busyTimer,
            onAction: (action, durationSec) => timerAction(openMatchNow, action, durationSec),
          }}
          onClose={() => setOpen(null)}
          onAuthError={codeRejected}
          onDone={(result) => {
            setOpen(null);
            confirmSaved(openMatchNow, result);
            refetch();
          }}
          onQueued={() => flash(no.control.queuedToast)}
          onConflict={() => {
            flash(openMode === "correct" ? no.control.editWindowGone : no.control.conflict, "error");
            refetch();
          }}
        />
      )}

      {showStandings && hasStandings && (
        <StandingsSheet
          state={{ standings, groupStandings }}
          teams={teams}
          showDraw={showDraw}
          onClose={() => setShowStandings(false)}
        />
      )}

      {/* Always mounted so the live region exists before the text lands —
          screen readers announce content changes, not freshly inserted regions. */}
      {toastRegion}
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
      <div className="card card-pad stack codegate">
        <div className="brand codegate-brand">
          <span className="brand-mark">T</span>
          {title || no.brand}
        </div>
        <h2 className="center">{no.pair.reenterTitle}</h2>
        <p className="faint center codegate-hint">{no.pair.reenterHint}</p>
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
        {err && <div className="toast-danger codegate-hint">{err}</div>}
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
