"use client";

import { useEffect } from "react";

/** A projector nobody touches must recover by itself: retry after `ms`. */
export function useAutoReset(reset: () => void, ms = 5000) {
  useEffect(() => {
    const t = setTimeout(reset, ms);
    return () => clearTimeout(t);
  }, [reset, ms]);
}
