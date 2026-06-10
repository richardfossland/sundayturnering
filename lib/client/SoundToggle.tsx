"use client";

import { useEffect, useState } from "react";
import { setSoundEnabled, unlockAudio } from "@/lib/client/sound";

const KEY = "turnering:sound";

/** Board sound on/off (fixed, bottom-right) + a one-time "tap for sound" hint.
 * Browsers keep audio suspended until a gesture on THIS page, so a board opened
 * via navigation is silent until someone taps it — the hint makes that obvious
 * and unlocks audio on the first tap. */
export function SoundToggle() {
  const [on, setOn] = useState(true);
  const [unlocked, setUnlocked] = useState(true); // assume ok until we know better

  useEffect(() => {
    let v = true;
    try {
      v = localStorage.getItem(KEY) !== "off";
    } catch {}
    setSoundEnabled(v);
    /* eslint-disable react-hooks/set-state-in-effect -- read stored pref + audio state */
    setOn(v);
    setUnlocked(false); // not unlocked until a gesture lands on this page
    /* eslint-enable react-hooks/set-state-in-effect */
    const unlock = () => {
      unlockAudio();
      setUnlocked(true);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  function toggle() {
    const next = !on;
    setOn(next);
    setSoundEnabled(next);
    setUnlocked(true);
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {}
  }

  return (
    <>
      {on && !unlocked && (
        <button className="sound-hint" onClick={() => setUnlocked(true)}>
          🔊 Trykk for lyd
        </button>
      )}
      <button
        className="sound-toggle"
        onClick={toggle}
        aria-label={on ? "Slå av lyd" : "Slå på lyd"}
        title={on ? "Lyd på" : "Lyd av"}
      >
        {on ? "🔊" : "🔇"}
      </button>
    </>
  );
}
