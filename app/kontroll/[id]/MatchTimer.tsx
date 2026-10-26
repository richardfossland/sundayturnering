"use client";

import { Icon } from "@/lib/client/Icon";
import { no } from "@/lib/locale/no";
import type { TimerState } from "@/lib/types";
import { TimerLeft } from "./clock";

/** The referee's countdown, inside the result sheet: «Nedtelling for denne
 * banen». Same /api/match/timer calls the bar at the top of the page used to
 * make — start 5/8/10 min, +1 min, stop — just where the match is being run. */
export function MatchTimer({
  timer,
  perCourt,
  busy,
  onAction,
}: {
  timer: TimerState | null;
  /** Parallel tournament: the clock belongs to this court, not the tournament. */
  perCourt: boolean;
  busy: boolean;
  onAction: (action: "start" | "add" | "stop", durationSec?: number) => void;
}) {
  const endsAt = timer?.running && timer.endsAt ? Date.parse(timer.endsAt) : null;
  return (
    <details
      className="disclosure"
      onToggle={(e) => {
        // Opened at the bottom of a scrolling sheet: bring the buttons up
        // (scrollTop, not scrollIntoView, which would scroll every ancestor).
        const el = e.currentTarget;
        if (el.open) {
          const body = el.closest<HTMLElement>(".sheet-body");
          if (body) body.scrollTop = body.scrollHeight;
        }
      }}
    >
      <summary className="disclosure-sum">
        <span className="disclosure-title">
          {perCourt ? no.control.countdownCourt : no.control.countdownTitle}
          {endsAt != null && (
            <span className="disclosure-live">
              <TimerLeft endsAt={endsAt} />
            </span>
          )}
        </span>
        <Icon name="chevronDown" size={16} className="disclosure-chev" />
      </summary>
      <div className="disclosure-body">
        <div className="btn-row">
          {[5, 8, 10].map((min) => (
            <button
              key={min}
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onAction("start", min * 60)}
            >
              {min} min
            </button>
          ))}
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAction("add")}>
            +1 min
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAction("stop")}>
            {no.control.timerStop}
          </button>
        </div>
      </div>
    </details>
  );
}
