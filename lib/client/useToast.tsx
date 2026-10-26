"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Flash = (message: string, tone?: "error") => void;

/** One transient message at a time: a new one replaces (and restarts) the
 * previous, and an unmount never sets state on a dead component. `region` is
 * always rendered so the live region exists before the text lands (screen
 * readers announce changes, not freshly inserted regions). */
export function useToast() {
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const flash = useCallback<Flash>((text, tone) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ text, error: tone === "error" });
    timer.current = setTimeout(() => {
      timer.current = null;
      setToast(null);
    }, 3200);
  }, []);
  const region = (
    <div
      role="status"
      aria-live="polite"
      className={toast ? `toast${toast.error ? " toast-danger" : ""}` : undefined}
    >
      {toast?.text}
    </div>
  );
  return { flash, region };
}
