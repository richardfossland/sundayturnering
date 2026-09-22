"use client";

import { useCallback, useEffect, useState } from "react";

/** Page fullscreen for the projector board. `supported` is false where the
 * Fullscreen API is unavailable (iPhone Safari), so callers hide the button. */
export function useFullscreen() {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- read browser capability post-mount */
    setSupported(!!document.fullscreenEnabled);
    setActive(!!document.fullscreenElement);
    /* eslint-enable react-hooks/set-state-in-effect */
    const onChange = () => setActive(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  return { supported, active, toggle };
}
