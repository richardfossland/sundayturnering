"use client";

import { useEffect, useRef, useState } from "react";
import { playBuzzer } from "@/lib/client/sound";
import { timerView } from "@/lib/tournament/timer";
import type { TimerState } from "@/lib/types";

// Board countdown driven by a timer's endsAt. Buzzes once at zero, but only when the
// expiry is seen live (not on reload/reconnect); «TID!» fades out after 60 s. `compact`
// renders a smaller chip for per-court display.
export function BoardTimer({
  timer,
  compact,
}: {
  timer: TimerState | null;
  compact?: boolean;
}) {
  const [remaining, setRemaining] = useState(0);
  const [hidden, setHidden] = useState(false);
  const buzzed = useRef(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- drive a countdown clock */
    if (!timer?.running || !timer.endsAt) {
      setRemaining(0);
      setHidden(false);
      return;
    }
    const end = Date.parse(timer.endsAt);
    buzzed.current = false;
    const tick = () => {
      const v = timerView(end, Date.now());
      setRemaining(v.remaining);
      setHidden(v.hidden);
      if (v.remaining <= 0 && !buzzed.current) {
        buzzed.current = true; // consumed even when stale → never buzz later
        if (v.buzz) playBuzzer();
      }
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [timer?.endsAt, timer?.running]);

  if (!timer?.running || !timer.endsAt || hidden) return null;
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  const low = remaining <= 10 && remaining > 0;
  return (
    <div
      className={`board-timer${compact ? " board-timer-sm" : ""}${low ? " low" : ""}${
        remaining <= 0 ? " done" : ""
      }`}
    >
      {remaining > 0 ? `${m}:${String(s).padStart(2, "0")}` : "TID!"}
    </div>
  );
}
