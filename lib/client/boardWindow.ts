"use client";

/** Open the projector board in its own window so the page the organiser is on
 * (and its codes) stays put — navigating the same tab to the board used to
 * lose the organiser code on the next Back press.
 *
 * The window is named per tournament: pressing the button again re-targets the
 * same window instead of stacking copies. Returns false when the browser
 * blocked it; the caller then offers a plain target=_blank link (a real link
 * click is never popup-blocked). No `noopener` feature on purpose — with it
 * window.open always returns null and a blocked window can't be detected. */
const opened = new Map<string, Window>();

export function openBoardWindow(id: string): boolean {
  // Already open from this page: just bring it forward — re-opening by name
  // would reload the board (and drop its one-time sound unlock).
  const existing = opened.get(id);
  if (existing && !existing.closed) {
    try {
      existing.focus();
    } catch {}
    return true;
  }
  const w = window.open(
    boardPath(id),
    `turnering-tavle-${id}`,
    "popup,width=1280,height=800",
  );
  if (!w) return false;
  opened.set(id, w);
  try {
    w.focus();
  } catch {}
  return true;
}

export function boardPath(id: string): string {
  return `/board/${id}`;
}
