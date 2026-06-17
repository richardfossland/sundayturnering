"use client";

import { useEffect, useState } from "react";
import { useCommentator } from "@/lib/client/useCommentator";
import { initials, teamMap } from "@/lib/client/view";
import { no } from "@/lib/locale/no";
import {
  isSpeechEnabled,
  setSpeechEnabled,
  speak,
  speechSupported,
} from "@/lib/client/speech";
import type { StateDTO } from "@/lib/dto";
import type { Storyline, StorylineKind } from "@/lib/tournament/narrate";

const ICON: Record<StorylineKind, string> = {
  champion: "🏆",
  final: "🥇",
  playoff: "🎬",
  upset: "⚡",
  clinch: "✅",
  lead_change: "📈",
  rout: "💥",
  draw: "🤝",
  result: "⚽",
  live: "🔴",
};

const CUTIN_MS = 6000;
const SPEECH_KEY = "turnering:speaker";

/**
 * Board-side commentator overlay: a bottom ticker + full-screen cut-in cards,
 * driven entirely by the keyless `useCommentator` diff. Optional browser-native
 * read-aloud toggle (Web Speech). Never blocks or alters the result path.
 */
export function Commentator({ state }: { state: StateDTO | null }) {
  const { ticker, cutin, dismissCutin } = useCommentator(state);
  const [tts, setTts] = useState(false);
  const supported = speechSupported();
  const teams = teamMap(state?.teams ?? []);

  // Restore the read-aloud preference once on mount.
  useEffect(() => {
    if (!supported) return;
    let v = false;
    try {
      v = localStorage.getItem(SPEECH_KEY) === "on";
    } catch {}
    setSpeechEnabled(v);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore stored pref
    setTts(v);
    // Some browsers populate voices asynchronously; nudge the list.
    try {
      window.speechSynthesis.getVoices();
    } catch {}
  }, [supported]);

  // Auto-dismiss the current cut-in after a few seconds, and read it aloud.
  useEffect(() => {
    if (!cutin) return;
    if (isSpeechEnabled()) {
      speak(cutin.detail ? `${cutin.headline} ${cutin.detail}` : cutin.headline);
    }
    const t = setTimeout(dismissCutin, CUTIN_MS);
    return () => clearTimeout(t);
  }, [cutin, dismissCutin]);

  function toggleTts() {
    const next = !tts;
    setTts(next);
    setSpeechEnabled(next);
    try {
      localStorage.setItem(SPEECH_KEY, next ? "on" : "off");
    } catch {}
  }

  const accent = (l: Storyline) =>
    (l.teamId && teams.get(l.teamId)?.colour) || "var(--gold)";

  return (
    <>
      {supported && (
        <button
          className="speaker-toggle"
          onClick={toggleTts}
          aria-pressed={tts}
          aria-label={tts ? no.narrate.ttsOnTitle : no.narrate.ttsOffTitle}
          title={tts ? no.narrate.ttsOnTitle : no.narrate.ttsOffTitle}
        >
          {tts ? "🗣️" : "💬"} {no.narrate.ttsOff}
        </button>
      )}

      {cutin && (
        <div
          className="speaker-cutin"
          onClick={dismissCutin}
          style={{ ["--speaker-accent" as string]: accent(cutin) }}
        >
          <div className={`speaker-card speaker-${cutin.kind}`}>
            <div className="speaker-card-badge">
              {cutin.teamId && teams.get(cutin.teamId) ? (
                <span
                  className="speaker-emblem"
                  style={{ background: accent(cutin) }}
                >
                  {initials(teams.get(cutin.teamId)!.name)}
                </span>
              ) : (
                <span className="speaker-icon">{ICON[cutin.kind]}</span>
              )}
            </div>
            <div className="speaker-card-text">
              <div className="speaker-eyebrow">{no.narrate.badge}</div>
              <div className="speaker-headline">{cutin.headline}</div>
              {cutin.detail && (
                <div className="speaker-detail">{cutin.detail}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {ticker.length > 0 && (
        <div className="speaker-ticker" aria-live="polite" aria-atomic="false">
          <span className="speaker-ticker-badge">🎙️ {no.narrate.badge}</span>
          <div className="speaker-ticker-track">
            {ticker.map((l) => (
              <span key={l.key} className="speaker-ticker-item">
                <span className="speaker-ticker-icon">{ICON[l.kind]}</span>
                {l.headline}
                {l.detail ? ` · ${l.detail}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
