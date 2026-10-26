"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import { matchTime } from "@/lib/client/view";
import { callCandidates, matchRest, suggestNext } from "@/lib/tournament/courts";
import type { Court } from "@/lib/types";
import { matchLabeler, ToolSection, type ToolsCtx } from "./shared";

/** How many queued matches a court shows before «Vis alle». */
const VISIBLE = 3;

/** «Baner nå»: per bane hva som spilles, hvem som er kalt opp og de neste
 * kampene (tidligst med uthvilte lag foreslått). Kall opp / angre. Velger
 * arrangøren en kamp med lag som fortsatt hviler, vises nedtellingen og det
 * kreves bekreftelse. */
export function CourtsSection(ctx: ToolsCtx) {
  const { courts, tournament } = ctx;
  // Hvile-nedtellingen tickes hvert 15. sekund.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const nowIso = new Date(now).toISOString();
  const minRest = tournament.config?.schedule?.minRestMinutes ?? 0;

  return (
    <ToolSection id="courts" title={no.tools.courtsTitle} intro={no.tools.courtsIntro}>
      <div className="court-list">
        {courts.map((c) => (
          <CourtCard key={c.id} court={c} nowIso={nowIso} minRest={minRest} {...ctx} />
        ))}
      </div>
    </ToolSection>
  );
}

function CourtCard({
  court: c,
  nowIso,
  minRest,
  tournament,
  matches,
  teams,
  code,
  busy,
  guard,
  flash,
}: ToolsCtx & { court: Court; nowIso: string; minRest: number }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const { teamName, label } = matchLabeler(teams);

  const here = matches.filter((m) => m.court_id === c.id);
  const live = here.find((m) => m.status === "live");
  const called = here.find((m) => m.status === "called");
  // Etter tidlig sluttspillstart kan uspilte seriekamper ikke lenger føres (serveren
  // svarer «serien_avsluttet»), så de står verken i køen eller som forslag.
  const status = tournament.status;
  const candidates = callCandidates(c.id, matches, status);
  const suggested = suggestNext(c.id, matches, nowIso, minRest, status);
  const chosen =
    candidates.find((m) => m.id === picked) ?? suggested ?? candidates[0] ?? null;
  const rest = chosen ? matchRest(chosen, matches, nowIso, minRest) : null;
  const restMin = rest && rest.ms > 0 ? Math.ceil(rest.ms / 60_000) : 0;

  // The first few in queue order; the chosen one is always shown, even when it
  // sits further down (the suggestion skips matches whose teams still rest).
  let shown = all ? candidates : candidates.slice(0, VISIBLE);
  if (chosen && !shown.some((m) => m.id === chosen.id)) shown = [...shown, chosen];
  const free = !live && !called;

  return (
    <div className="court-card">
      <div className="court-head">
        <strong className="court-name">{c.name}</strong>
        {live && (
          <span className="pill pill-live"><span className="dot" />{no.control.courtLive}</span>
        )}
        {called && <span className="pill pill-called">{no.control.courtCalled}</span>}
        {free && <span className="pill">{no.control.courtEmpty}</span>}
      </div>

      {live && <p className="court-match">{label(live)}</p>}
      {called && (
        <div className="court-called">
          <p className="court-match">{label(called)}</p>
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
        </div>
      )}

      {free &&
        (candidates.length === 0 ? (
          <p className="hint">{no.control.courtNoSuggestion}</p>
        ) : (
          <>
            <fieldset className="pick-list">
              <legend className="label">{no.tools.courtNext}</legend>
              {shown.map((m) => (
                <label key={m.id} className="pick-row" data-on={m.id === chosen?.id}>
                  <input
                    type="radio"
                    name={`pick-${c.id}`}
                    checked={m.id === chosen?.id}
                    onChange={() => setPicked(m.id)}
                  />
                  <span className="pick-text">
                    <span className="pick-teams">{label(m)}</span>
                    <span className="pick-meta">
                      {matchTime(m.scheduled_at)}
                      {m.scheduled_at && m.id === suggested?.id && " · "}
                      {m.id === suggested?.id && (
                        <span className="pick-tag">{no.control.suggestedTag}</span>
                      )}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            {candidates.length > VISIBLE && (
              <button type="button" className="link-btn" onClick={() => setAll((v) => !v)}>
                {all ? no.tools.showLess : no.tools.showAll(candidates.length)}
              </button>
            )}
            {restMin > 0 && rest?.teamId && (
              <p className="org-warn" role="status">
                {no.control.restWarning(teamName(rest.teamId), restMin)}
              </p>
            )}
            {chosen && (
              <button
                type="button"
                className="btn btn-gold"
                disabled={busy || !code}
                onClick={async () => {
                  if (
                    restMin > 0 &&
                    rest?.teamId &&
                    !confirm(no.control.restConfirm(teamName(rest.teamId), restMin))
                  )
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
          </>
        ))}
    </div>
  );
}
