"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { ResultInput } from "@/lib/client/ResultInput";
import { resolve } from "@/lib/tournament/scoring";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { NumberField } from "@/lib/client/NumberField";
import { errorMessage } from "@/lib/locale/errors";
import { useEscape } from "@/lib/client/useEscape";
import { matchTime } from "@/lib/client/view";
import { swissProgress } from "@/lib/tournament/swiss";
import { previewShift } from "@/lib/tournament/schedule";
import { callCandidates, matchRest, suggestNext } from "@/lib/tournament/courts";
import type { Court, Match, MatchResult, Team } from "@/lib/types";
import type { TournamentDTO } from "@/lib/dto";

export function OrganiserPanel({
  tournament,
  matches,
  teams,
  courts,
  onChanged,
  flash,
}: {
  tournament: TournamentDTO;
  matches: Match[];
  teams: Map<string, Team>;
  courts: Court[];
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
      flash(errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const canAdvance =
    (tournament.format === "league_playoff" ||
      tournament.format === "group_playoff") &&
    tournament.status === "league";
  const swiss =
    tournament.format === "swiss" && tournament.status === "league"
      ? swissProgress(matches, tournament.config?.swiss?.rounds ?? 0)
      : null;
  // «Start neste runde» når runden er ferdig og det er flere igjen.
  const canNextRound = !!swiss && swiss.complete && swiss.round < swiss.total;
  const canFinish = tournament.status !== "finished";
  const canReopen = tournament.status === "finished";
  const doneMatches = matches.filter((m) => m.status === "done");

  if (!openPanel)
    return (
      <button className="btn btn-ghost btn-block" onClick={() => setOpenPanel(true)}>
        <Icon name="settings" />
        {no.control.organiser}
      </button>
    );

  return (
    <div className="card card-pad stack">
      <div className="spread">
        <h2 style={{ fontSize: "1.2rem" }}>{no.control.organiser}</h2>
        <button className="btn btn-ghost" onClick={() => setOpenPanel(false)} aria-label={no.common.close}>
          <Icon name="close" />
        </button>
      </div>

      <a
        className="btn btn-block"
        href={`/resultat/${tournament.id}`}
        target="_blank"
        rel="noopener"
      >
        <Icon name="award" />
        Resultater &amp; diplom
      </a>

      <div className="field">
        <label className="label" htmlFor="organiser-code">{no.control.organiserCode}</label>
        <input
          id="organiser-code"
          className="input"
          autoComplete="off"
          value={code}
          onChange={(e) => saveCode(e.target.value.toUpperCase())}
          placeholder="KODE-XX"
        />
        <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>
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
              const r = await guard(async () => {
                try {
                  return await api.advance(tournament.id, code);
                } catch (e) {
                  // Unplayed league/group matches: only on purpose.
                  if (!(e instanceof ApiError && e.code === "uspilte_kamper")) throw e;
                  if (!confirm(no.control.advanceUnplayed(Number(e.data?.count ?? 0))))
                    return null;
                  return await api.advance(tournament.id, code, { force: true });
                }
              });
              if (r) flash(no.control.advancePlayoff);
            }}
          >
            {no.control.advancePlayoff}
          </button>
        )}
        {swiss && (
          <div className="faint" style={{ alignSelf: "center" }}>
            {no.board.swissRound(swiss.round, swiss.total)}
          </div>
        )}
        {canNextRound && (
          <button
            className="btn btn-gold"
            disabled={busy || !code}
            onClick={async () => {
              if (!confirm(no.control.nextRoundConfirm)) return;
              const r = await guard(() => api.advance(tournament.id, code));
              if (r) flash(no.control.nextRoundDone(swiss!.round + 1));
            }}
          >
            {no.control.nextRound}
          </button>
        )}
        {canFinish && (
          <button
            className="btn btn-danger"
            disabled={busy || !code}
            onClick={async () => {
              if (!confirm(no.control.finish + "?")) return;
              await guard(async () => {
                try {
                  return await api.finish(tournament.id, code);
                } catch (e) {
                  // B-sluttspill/trøsterunde ikke ferdig: bare med vilje.
                  if (!(e instanceof ApiError && e.code === "b_sluttspill_pagar")) throw e;
                  if (!confirm(no.control.finishBOpen(Number(e.data?.count ?? 0)))) return null;
                  return await api.finish(tournament.id, code, { force: true });
                }
              });
            }}
          >
            {no.control.finish}
          </button>
        )}
        {canReopen && (
          <button
            className="btn"
            disabled={busy || !code}
            onClick={async () => {
              if (!confirm(no.control.reopenConfirm)) return;
              const r = await guard(() => api.reopen(tournament.id, code));
              if (r) flash(no.control.reopened);
            }}
          >
            {no.control.reopen}
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

      {courts.length > 0 && (
        <CourtsSection
          tournament={tournament}
          matches={matches}
          teams={teams}
          courts={courts}
          code={code}
          busy={busy}
          guard={guard}
          flash={flash}
        />
      )}

      {tournament.config?.schedule && (
        <ShiftSection
          tournament={tournament}
          matches={matches}
          teams={teams}
          courts={courts}
          code={code}
          busy={busy}
          guard={guard}
          flash={flash}
        />
      )}

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
        />
      )}
    </div>
  );
}

/** «Baner»: per bane hva som spilles, hvem som er kalt opp og foreslått neste
 * kamp (tidligst med uthvilte lag). Kall opp / angre. Velger arrangøren en kamp
 * med lag som fortsatt hviler, vises nedtellingen og det kreves bekreftelse. */
function CourtsSection({
  tournament,
  matches,
  teams,
  courts,
  code,
  busy,
  guard,
  flash,
}: {
  tournament: TournamentDTO;
  matches: Match[];
  teams: Map<string, Team>;
  courts: Court[];
  code: string;
  busy: boolean;
  guard: <T>(fn: () => Promise<T>) => Promise<T | null>;
  flash: (m: string) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  // Hvile-nedtellingen tickes hvert 15. sekund.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const nowIso = new Date(now).toISOString();
  const minRest = tournament.config?.schedule?.minRestMinutes ?? 0;

  const teamName = (id: string | null) => (id ? (teams.get(id)?.name ?? "?") : "?");
  const label = (m: Match) => `${teamName(m.home_team_id)} – ${teamName(m.away_team_id)}`;
  const timed = (m: Match) => (matchTime(m.scheduled_at) ? `${matchTime(m.scheduled_at)} · ` : "");

  return (
    <>
      <div className="divider" />
      <h3 className="label" id="courts-title">{no.control.courtsTitle}</h3>
      <div className="stack" style={{ gap: 10 }} role="group" aria-labelledby="courts-title">
        {courts.map((c) => {
          const here = matches.filter((m) => m.court_id === c.id);
          const live = here.find((m) => m.status === "live");
          const called = here.find((m) => m.status === "called");
          const candidates = callCandidates(c.id, matches);
          const suggested = suggestNext(c.id, matches, nowIso, minRest);
          const chosen =
            candidates.find((m) => m.id === picked[c.id]) ?? suggested ?? candidates[0] ?? null;
          const rest = chosen ? matchRest(chosen, matches, nowIso, minRest) : null;
          const restMin = rest && rest.ms > 0 ? Math.ceil(rest.ms / 60_000) : 0;

          return (
            <div className="match-card" key={c.id} style={{ cursor: "default", alignItems: "stretch" }}>
              <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
                <strong>{c.name}</strong>
                {live && (
                  <div>
                    <span className="pill pill-live"><span className="dot" />{no.control.courtLive}</span>{" "}
                    {label(live)}
                  </div>
                )}
                {called && (
                  <div>
                    <span className="pill pill-called">{no.control.courtCalled}</span> {label(called)}
                  </div>
                )}
                {!live && !called && <span className="faint">{no.control.courtEmpty}</span>}

                {!live && !called && (
                  <>
                    {candidates.length === 0 ? (
                      <span className="faint" style={{ fontSize: ".88rem" }}>
                        {no.control.courtNoSuggestion}
                      </span>
                    ) : (
                      <select
                        className="select"
                        aria-label={`${no.control.courtSuggested} – ${c.name}`}
                        value={chosen?.id ?? ""}
                        onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.value }))}
                      >
                        {candidates.map((m) => (
                          <option key={m.id} value={m.id}>
                            {timed(m)}
                            {label(m)}
                            {m.id === suggested?.id ? ` (${no.control.suggestedTag})` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    {restMin > 0 && rest?.teamId && (
                      <span role="status" style={{ color: "var(--warn)", fontSize: ".88rem" }}>
                        {no.control.restWarning(teamName(rest.teamId), restMin)}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="stack" style={{ gap: 6, justifyContent: "center" }}>
                {called && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy || !code}
                    onClick={async () => {
                      const r = await guard(() =>
                        api.call(tournament.id, code, { matchId: called.id, courtId: c.id, undo: true }),
                      );
                      if (r) flash(no.control.callUndone);
                    }}
                  >
                    {no.control.callUndo}
                  </button>
                )}
                {!live && !called && chosen && (
                  <button
                    type="button"
                    className="btn btn-gold"
                    disabled={busy || !code}
                    onClick={async () => {
                      if (restMin > 0 && rest?.teamId && !confirm(no.control.restConfirm(teamName(rest.teamId), restMin)))
                        return;
                      const r = await guard(() =>
                        api.call(tournament.id, code, { matchId: chosen.id, courtId: c.id }),
                      );
                      if (r) flash(no.control.calledDone(c.name));
                    }}
                  >
                    {no.control.callUp}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** «Skyv tidsplanen»: velg bane, fra når og hvor mange minutter; forhåndsvisning
 * (gul) av berørte kamper før «Bekreft». Reglene kommer fra previewShift. */
function ShiftSection({
  tournament,
  matches,
  teams,
  courts,
  code,
  busy,
  guard,
  flash,
}: {
  tournament: TournamentDTO;
  matches: Match[];
  teams: Map<string, Team>;
  courts: Court[];
  code: string;
  busy: boolean;
  guard: <T>(fn: () => Promise<T>) => Promise<T | null>;
  flash: (m: string) => void;
}) {
  const [courtId, setCourtId] = useState("");
  const [fromId, setFromId] = useState(""); // "" = nå
  const [mins, setMins] = useState(10);
  // "Nå" tickes når panelet tegnes på nytt (refetch) — nok for en forhåndsvisning.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const upcoming = matches
    .filter((m) => m.status !== "done" && m.status !== "bye" && m.status !== "live" && m.scheduled_at)
    .filter((m) => !courtId || m.court_id === courtId)
    .sort((a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!));
  const fromMatch = upcoming.find((m) => m.id === fromId);
  // Standard: alle uspilte kamper, også de som er forsinket (før «nå»).
  const fromIso = fromMatch?.scheduled_at ?? new Date(0).toISOString();
  const { changes, error } = previewShift(matches, {
    courtId: courtId || null,
    fromIso,
    minutes: mins,
    nowIso: new Date(now).toISOString(),
  });
  const byId = new Map(matches.map((m) => [m.id, m]));
  const courtName = new Map(courts.map((c) => [c.id, c.name]));
  const label = (m: Match) =>
    `${m.home_team_id ? (teams.get(m.home_team_id)?.name ?? "?") : "?"} – ${
      m.away_team_id ? (teams.get(m.away_team_id)?.name ?? "?") : "?"
    }`;

  return (
    <>
      <div className="divider" />
      <h3 className="label" id="shift-title">{no.control.shiftTitle}</h3>
      <div className="stack" style={{ gap: 8 }} role="group" aria-labelledby="shift-title">
        <div className="field">
          <label className="label" htmlFor="shift-court">{no.control.shiftCourt}</label>
          <select
            id="shift-court"
            className="select"
            value={courtId}
            onChange={(e) => {
              setCourtId(e.target.value);
              setFromId("");
            }}
          >
            <option value="">{no.control.shiftAllCourts}</option>
            {courts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="shift-from">{no.control.shiftFrom}</label>
          <select
            id="shift-from"
            className="select"
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
          >
            <option value="">{no.control.shiftFromNow}</option>
            {upcoming.map((m) => (
              <option key={m.id} value={m.id}>
                {matchTime(m.scheduled_at)} · {label(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="btn-row">
          {[-5, 5, 10, 15].map((d) => (
            <button
              key={d}
              type="button"
              className="btn btn-ghost"
              onClick={() => setMins(d)}
            >
              {d > 0 ? `+${d}` : `−${-d}`}
            </button>
          ))}
        </div>
        <div className="field">
          <label className="label" htmlFor="shift-minutes">{no.control.shiftMinutes}</label>
          <NumberField id="shift-minutes" min={-240} max={240} value={mins} onChange={setMins} suffix="min" />
        </div>

        {error ? (
          <div className="faint" role="status" style={{ fontSize: ".88rem" }}>
            {errorMessage(new ApiError(400, error))}
          </div>
        ) : (
          <div role="status">
            <div className="faint" style={{ fontSize: ".88rem" }}>
              {no.control.shiftPreview(changes.length)}
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "grid", gap: 4 }}>
              {changes.map((c) => {
                const m = byId.get(c.matchId);
                return (
                  <li
                    key={c.matchId}
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      fontSize: ".9rem",
                    }}
                  >
                    <span style={{ color: "var(--gold-ink)", fontWeight: 700 }}>
                      {matchTime(c.before)} → {matchTime(c.after)}
                    </span>
                    {m && (
                      <span>
                        {label(m)}
                        {m.court_id && courtName.get(m.court_id) ? ` · ${courtName.get(m.court_id)}` : ""}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <button
          type="button"
          className="btn btn-gold"
          disabled={busy || !code || !!error}
          onClick={async () => {
            const r = await guard(() =>
              api.shift(tournament.id, code, {
                courtId: courtId || null,
                from: fromIso,
                minutes: mins,
              }),
            );
            if (r) flash(no.control.shiftDone(r.count));
          }}
        >
          {no.control.shiftConfirm}
        </button>
      </div>
    </>
  );
}

function OverrideModal({
  match,
  tournament,
  teams,
  code,
  onClose,
  onDone,
}: {
  match: Match;
  tournament: TournamentDTO;
  teams: Map<string, Team>;
  code: string;
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
          <h2 id="override-modal-title" style={{ fontSize: "1.2rem" }}>{no.control.override}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label={no.common.close}>
            <Icon name="close" />
          </button>
        </div>
        {err && (
          <div className="toast-danger" role="alert" style={{ fontSize: ".9rem" }}>
            {err}
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
        />
      </div>
    </div>
  );
}
