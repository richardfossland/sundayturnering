"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import { errorMessage } from "@/lib/locale/errors";
import { NumberField } from "@/lib/client/NumberField";
import { matchTime } from "@/lib/client/view";
import { isPlayable } from "@/lib/tournament/courts";
import { previewShift, shiftConflicts } from "@/lib/tournament/schedule";
import type { Match } from "@/lib/types";
import { matchLabeler, ToolSection, type ToolsCtx } from "./shared";

/** Quick picks for the minutes field. */
const QUICK = [-5, 5, 10, 15];
/** How many affected matches the preview lists before «og n til». */
const PREVIEW = 5;

/** «Forsink eller framskynd kamper»: velg bane, fra når og hvor mange minutter;
 * forhåndsvisning (gul) av berørte kamper før «Bekreft». Reglene kommer fra
 * previewShift. */
export function ShiftSection({
  tournament,
  matches,
  links,
  teams,
  courts,
  code,
  busy,
  guard,
  flash,
}: ToolsCtx) {
  const [courtId, setCourtId] = useState("");
  const [fromId, setFromId] = useState(""); // "" = nå
  const [mins, setMins] = useState(10);
  // "Nå" tickes når panelet tegnes på nytt (refetch) — nok for en forhåndsvisning.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Kamper som ikke lenger kan spilles (seriekamper etter at sluttspillet startet)
  // flyttes av databasen også, men hører ikke hjemme i forhåndsvisningen.
  const playable = (m: Match) => isPlayable(m, tournament.status);
  const upcoming = matches
    .filter((m) => m.status !== "done" && m.status !== "bye" && m.status !== "live" && m.scheduled_at)
    .filter(playable)
    .filter((m) => !courtId || m.court_id === courtId)
    .sort((a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!));
  const fromMatch = upcoming.find((m) => m.id === fromId);
  // Standard: alle uspilte kamper, også de som er forsinket (før «nå»).
  const fromIso = fromMatch?.scheduled_at ?? new Date(0).toISOString();
  const preview = previewShift(matches, {
    courtId: courtId || null,
    fromIso,
    minutes: mins,
    nowIso: new Date(now).toISOString(),
  });
  const byId = new Map(matches.map((m) => [m.id, m]));
  const unsorted = preview.changes.filter((c) => {
    const m = byId.get(c.matchId);
    return !m || playable(m);
  });
  // Bare ukjente-tidspunkt-feil og «ingenting å flytte» er feil; alt annet kan bekreftes.
  const error = preview.error ?? (unsorted.length === 0 ? "ingen_kamper" : null);
  const courtName = new Map(courts.map((c) => [c.id, c.name]));
  // Forhåndsvisningen følger klokka (tidligst først), og banen avgjør ved lik tid.
  const courtOrder = new Map(courts.map((c) => [c.id, c.sort_order]));
  const changes = [...unsorted].sort((a, b) => {
    const dt = Date.parse(a.before) - Date.parse(b.before);
    if (dt !== 0) return dt;
    const ca = courtOrder.get(byId.get(a.matchId)?.court_id ?? "") ?? Infinity;
    const cb = courtOrder.get(byId.get(b.matchId)?.court_id ?? "") ?? Infinity;
    return ca - cb;
  });
  const { label } = matchLabeler(teams);

  // Konflikter forskyvningen skaper (databasen flytter rått): mater-kamp, samme lag
  // to ganger, hvile, samme bane. Må bekreftes en gang til med «Flytt likevel».
  const schedule = tournament.config?.schedule;
  const conflicts =
    schedule && !error
      ? shiftConflicts(
          matches,
          (links ?? []).map(({ from_match_id, to_match_id }) => ({ from_match_id, to_match_id })),
          unsorted,
          schedule,
          tournament.status,
        )
      : [];
  const key = `${courtId}|${fromId}|${mins}`;
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const armed = armedKey === key && conflicts.length > 0;

  async function doShift() {
    const r = await guard(() =>
      api.shift(tournament.id, code, {
        courtId: courtId || null,
        from: fromIso,
        minutes: mins,
      }),
    );
    setArmedKey(null);
    if (r) flash(no.control.shiftDone(r.count));
  }

  return (
    <ToolSection id="shift" title={no.tools.scheduleTitle} intro={no.tools.scheduleIntro}>
      <div className="org-form">
        {courts.length > 1 && (
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
        )}
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
      </div>

      <div className="field">
        <span className="label" id="shift-minutes-label">{no.control.shiftMinutes}</span>
        <div className="chips" role="group" aria-label={no.tools.scheduleQuick}>
          {QUICK.map((d) => (
            <button
              key={d}
              type="button"
              className="chip"
              data-on={mins === d}
              onClick={() => setMins(d)}
            >
              {d > 0 ? `+${d}` : `−${-d}`} min
            </button>
          ))}
        </div>
        <NumberField
          id="shift-minutes"
          aria-label={no.control.shiftMinutes}
          min={-240}
          max={240}
          value={mins}
          onChange={setMins}
          suffix="min"
        />
      </div>

      {error ? (
        <p className="hint" role="status">
          {error === "ingen_kamper" && !preview.error
            ? no.control.shiftNone
            : errorMessage(new ApiError(400, error))}
        </p>
      ) : (
        <div className="shift-preview" role="status">
          <div className="label">{no.control.shiftPreview(changes.length)}</div>
          <ul className="shift-list">
            {changes.slice(0, PREVIEW).map((c) => {
              const m = byId.get(c.matchId);
              return (
                <li key={c.matchId}>
                  <span className="shift-time">
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
          {changes.length > PREVIEW && (
            <p className="hint">{no.tools.more(changes.length - PREVIEW)}</p>
          )}
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="shift-warn" role="alert">
          <strong>{no.control.shiftWarnTitle(conflicts.length)}</strong>
          <ul className="shift-list">
            {conflicts.slice(0, PREVIEW).map((c) => {
              const a = byId.get(c.matchId);
              const b = byId.get(c.otherId);
              return (
                <li key={`${c.kind}${c.matchId}${c.otherId}`}>
                  {a && b ? no.control.shiftConflict(c.kind, label(a), label(b)) : c.kind}
                </li>
              );
            })}
          </ul>
          {conflicts.length > PREVIEW && <p className="hint">{no.tools.more(conflicts.length - PREVIEW)}</p>}
          <p className="hint">{no.control.shiftWarnHint}</p>
        </div>
      )}

      {armed ? (
        <div className="shift-actions">
          <button type="button" className="btn btn-danger" disabled={busy || !code} onClick={doShift}>
            {no.control.shiftAnyway}
          </button>
          <button type="button" className="btn" onClick={() => setArmedKey(null)}>
            {no.common.cancel}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-gold"
          disabled={busy || !code || !!error}
          onClick={() => (conflicts.length > 0 ? setArmedKey(key) : doShift())}
        >
          {no.control.shiftConfirm}
        </button>
      )}
    </ToolSection>
  );
}
