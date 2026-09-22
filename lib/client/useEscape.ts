"use client";

import { useEffect, useRef } from "react";

/** Call `onEscape` when Escape is pressed while the component is mounted
 * (modals). Ref-held so an inline arrow from the parent doesn't re-bind. */
export function useEscape(onEscape: () => void) {
  const ref = useRef(onEscape);
  useEffect(() => {
    ref.current = onEscape;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
