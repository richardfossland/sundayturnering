"use client";

import { useEffect, useRef, useState } from "react";
import { playBuzzer } from "@/lib/client/sound";
import type { TimerState } from "@/lib/types";

// Board countdown driven by a timer's endsAt. Buzzes once at zero. `compact`
// renders a smaller chip for per-court display.
export function BoardTimer({
  timer,
  compact,
}: {
  timer: TimerState | null;
  compact?: boolean;
}) {
  const [remaining, setRemaining] = useState(0);
  const buzzed = useRef(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- drive a countdown clock */
    if (!timer?.running || !timer.endsAt) {
      setRemaining(0);
      return;
    }
    const end = Date.parse(timer.endsAt);
    buzzed.current = false;
    const tick = () => {
      const r = Math.max(0, Math.round((end - Date.now()) / 1000));
      setRemaining(r);
      if (r <= 0 && !buzzed.current) {
        buzzed.current = true;
        playBuzzer();
      }
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [timer?.endsAt, timer?.running]);

  if (!timer?.running || !timer.endsAt) return null;
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
