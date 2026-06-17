"use client";

// Browser-native read-aloud for the commentator feed. Web Speech API only —
// NO API key, NO network, NO bundled audio. If the browser lacks
// speechSynthesis (or has no Norwegian voice), this degrades to a silent no-op
// — the visual ticker/cut-ins still work. The board's existing sound on/off is
// independent; this is its own opt-in toggle.

let enabled = false;

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function setSpeechEnabled(v: boolean): void {
  enabled = v;
  if (!v && speechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

export function isSpeechEnabled(): boolean {
  return enabled;
}

/** Pick a Norwegian voice if the platform offers one, else any default. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith("nb")) ??
    voices.find((v) => v.lang?.toLowerCase().startsWith("no")) ??
    voices.find((v) => v.lang?.toLowerCase().startsWith("nn")) ??
    null
  );
}

/** Speak a line if read-aloud is on and supported. Never throws. */
export function speak(text: string): void {
  if (!enabled || !speechSupported() || !text.trim()) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "nb-NO";
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = 1.02;
    u.pitch = 1.0;
    // Cut off any in-flight line so the latest beat is heard promptly.
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    // Silent: visual feed is the source of truth.
  }
}
