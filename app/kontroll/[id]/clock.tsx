"use client";

import { useEffect, useState } from "react";

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Event-handler clock read (kept out of the component body for react-hooks/purity). */
export function wallClock(): number {
  return Date.now();
}

/** 1 s wall clock for LEAF components only. Ticking in ControlClient re-rendered
 * the whole control screen (all cards, organiser panel, modal) every second;
 * here just the tiny component that shows a countdown re-renders.
 * 0 until mounted keeps SSR/hydration identical. */
export function useNow(active = true): number {
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

export function TimerLeft({ endsAt }: { endsAt: number }) {
  const now = useNow();
  if (!now) return null;
  const left = endsAt - now;
  return (
    <strong className="timer-left" data-low={left < 60_000}>
      {fmtClock(left)}
    </strong>
  );
}
