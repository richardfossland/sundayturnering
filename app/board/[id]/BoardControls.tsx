"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { setSoundEnabled, unlockAudio } from "@/lib/client/sound";
import { no } from "@/lib/locale/no";

const SOUND_KEY = "turnering:sound";

/**
 * One small collapsible cluster in the corner of the board, replacing the three
 * separate floating buttons (home ⌂, codes ⚿, sound 🔊) that used to compete for
 * attention. Collapsed it's a single ⋯ disc; expanded it reveals the actions.
 *
 * `onCodes` opens the existing CodesOverlay (codes are managed by the parent so
 * the overlay keeps living at the board root). Spectator boards hide the codes
 * action entirely. Sound state + the one-time "tap for sound" hint are folded in
 * here so audio is still unlocked on the first interaction with the page.
 */
export function BoardControls({
  spectator,
  onCodes,
}: {
  spectator: boolean;
  onCodes: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [unlocked, setUnlocked] = useState(true);

  useEffect(() => {
    let v = true;
    try {
      v = localStorage.getItem(SOUND_KEY) !== "off";
    } catch {}
    setSoundEnabled(v);
    /* eslint-disable react-hooks/set-state-in-effect -- read stored pref + audio state */
    setSoundOn(v);
    setUnlocked(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    const unlock = () => {
      unlockAudio();
      setUnlocked(true);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    setUnlocked(true);
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {}
  }

  return (
    <>
      {soundOn && !unlocked && (
        <button className="sound-hint" onClick={() => setUnlocked(true)}>
          🔊 Trykk for lyd
        </button>
      )}
      <div className="board-controls" data-open={open || undefined}>
        {open && (
          <div className="board-controls-items">
            <Link
              className="board-ctl-btn"
              href="/"
              aria-label="Hjem"
              title="Hjem"
            >
              ⌂
            </Link>
            {!spectator && (
              <button
                className="board-ctl-btn"
                onClick={onCodes}
                aria-label={no.board.codesBtn}
                title={no.board.codesBtn}
              >
                ⚿
              </button>
            )}
            <button
              className="board-ctl-btn"
              onClick={toggleSound}
              aria-label={soundOn ? "Slå av lyd" : "Slå på lyd"}
              title={soundOn ? "Lyd på" : "Lyd av"}
            >
              {soundOn ? "🔊" : "🔇"}
            </button>
          </div>
        )}
        <button
          className="board-ctl-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Lukk meny" : "Meny"}
          aria-expanded={open}
          title="Meny"
        >
          {open ? "✕" : "⋯"}
        </button>
      </div>
    </>
  );
}
