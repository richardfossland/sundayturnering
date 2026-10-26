"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { setSoundEnabled, unlockAudio } from "@/lib/client/sound";
import { useFullscreen } from "@/lib/client/useFullscreen";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";

const SOUND_KEY = "turnering:sound";

/** The dock fades out after this long without mouse/touch/keyboard activity —
 * on a projector nobody should stare at buttons. */
const IDLE_MS = 4000;

/**
 * Icon buttons in the bottom corner of the board (home, fullscreen, codes,
 * sound). They fade out after a few seconds without activity and come back on
 * any mouse move, touch or key press (F still toggles fullscreen). The global
 * theme switch and the read-aloud toggle hide with them via `data-board-idle`
 * on <html>.
 *
 * `onCodes` opens the existing CodesOverlay (codes are managed by the parent so
 * the overlay keeps living at the board root). Sound state + the one-time "turn on sound" hint are folded in
 * here so audio is still unlocked on the first interaction with the page.
 */
export function BoardControls({ onCodes }: { onCodes: () => void }) {
  const [idle, setIdle] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [unlocked, setUnlocked] = useState(true);
  const fullscreen = useFullscreen();

  // Auto-hide: any activity shows the dock and restarts the countdown. Focus
  // inside the dock (keyboard) keeps it up.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const root = document.documentElement;
    const show = () => {
      setIdle(false);
      delete root.dataset.boardIdle;
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        if (document.activeElement?.closest(".board-dock")) return show();
        setIdle(true);
        root.dataset.boardIdle = "1";
      }, IDLE_MS);
    };
    show();
    const events = ["pointermove", "pointerdown", "keydown", "focusin"] as const;
    for (const e of events) window.addEventListener(e, show, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, show);
      if (t) clearTimeout(t);
      delete root.dataset.boardIdle;
    };
  }, []);

  // F toggles fullscreen on the projector (ignored while typing, e.g. the
  // board-code field in the codes overlay).
  const toggleFullscreen = fullscreen.toggle;
  const canFullscreen = fullscreen.supported;
  useEffect(() => {
    if (!canFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable]")) return;
      toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canFullscreen, toggleFullscreen]);

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

  const fsLabel = fullscreen.active ? no.board.exitFullscreen : no.board.fullscreen;
  return (
    <div className="board-dock" data-idle={idle || undefined} role="toolbar" aria-label={no.board.controlsLabel}>
      {soundOn && !unlocked && (
        <button className="board-sound-hint" onClick={() => setUnlocked(true)}>
          <Icon name="soundOn" size="1.2em" />
          {no.board.soundOnBtn}
        </button>
      )}
      <Link className="board-ctl-btn" href="/" aria-label={no.board.home} title={no.board.home}>
        <Icon name="home" size="1.2em" />
      </Link>
      {fullscreen.supported && (
        <button
          className="board-ctl-btn"
          onClick={fullscreen.toggle}
          aria-label={fsLabel}
          aria-pressed={fullscreen.active}
          title={`${fsLabel} (F)`}
        >
          <Icon name={fullscreen.active ? "exitFullscreen" : "fullscreen"} size="1.2em" />
        </button>
      )}
      <button
        className="board-ctl-btn"
        onClick={onCodes}
        aria-label={no.board.codesBtn}
        title={no.board.codesBtn}
      >
        <Icon name="code" size="1.2em" />
      </button>
      <button
        className="board-ctl-btn"
        onClick={toggleSound}
        aria-label={soundOn ? no.board.soundOffBtn : no.board.soundOnBtn}
        aria-pressed={soundOn}
        title={soundOn ? no.board.soundOnTip : no.board.soundOffTip}
      >
        <Icon name={soundOn ? "soundOn" : "soundOff"} size="1.2em" />
      </button>
    </div>
  );
}
