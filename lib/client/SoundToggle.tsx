"use client";

import { useEffect, useState } from "react";
import { setSoundEnabled, unlockAudio } from "@/lib/client/sound";

const KEY = "turnering:sound";

/** Board sound on/off (fixed, bottom-right). Also unlocks audio on first use. */
export function SoundToggle() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    let v = true;
    try {
      v = localStorage.getItem(KEY) !== "off";
    } catch {}
    setSoundEnabled(v);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read stored pref
    setOn(v);
    // Unlock audio on the first interaction anywhere on the board.
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  function toggle() {
    const next = !on;
    setOn(next);
    setSoundEnabled(next);
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {}
  }

  return (
    <button
      className="sound-toggle"
      onClick={toggle}
      aria-label={on ? "Slå av lyd" : "Slå på lyd"}
      title={on ? "Lyd på" : "Lyd av"}
    >
      {on ? "🔊" : "🔇"}
    </button>
  );
}
