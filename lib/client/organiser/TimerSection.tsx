"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import { matchTime } from "@/lib/client/view";
import { ToolSection, type ToolsCtx } from "./shared";

const PRESETS = [5, 8, 10, 15];

/** «Nedtelling»: the match countdown shown on the storskjerm. One place for it
 * on this page (the referee page keeps its own quick bar until D4). */
export function TimerSection({ tournament, code, busy, guard, flash }: ToolsCtx) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  const t = tournament.timer;
  const endsAt = t?.running && t.endsAt ? Date.parse(t.endsAt) : NaN;
  const running = Number.isFinite(endsAt) && endsAt > now;
  const until = running ? matchTime(t?.endsAt) : null;

  return (
    <ToolSection id="timer" title={no.tools.timerTitle} intro={no.tools.timerIntro}>
      <p className="org-status" role="status" data-on={running}>
        {until ? no.tools.timerRunning(until) : no.tools.timerIdle}
      </p>
      <div className="field">
        <span className="label">{no.tools.timerLabel}</span>
        <div className="timer-presets">
          {PRESETS.map((min) => (
            <button
              key={min}
              type="button"
              className="btn"
              disabled={busy || !code}
              onClick={async () => {
                const r = await guard(() => api.timer(tournament.id, code, "start", min * 60));
                if (r) flash(no.tools.timerStarted(min));
              }}
            >
              {min} min
            </button>
          ))}
        </div>
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || !code}
          onClick={async () => {
            const r = await guard(() => api.timer(tournament.id, code, "add"));
            if (r) flash(no.tools.timerAdded);
          }}
        >
          +1 min
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || !code}
          onClick={async () => {
            const r = await guard(() => api.timer(tournament.id, code, "stop"));
            if (r) flash(no.tools.timerStopped);
          }}
        >
          {no.control.timerStop}
        </button>
      </div>
    </ToolSection>
  );
}
