"use client";

import { tavleUrl } from "@/lib/client/storskjerm/usePresentasjon";

/** Open the projector board in its own window so the page the organiser is on
 * (and its codes) stays put — navigating the same tab to the board used to
 * lose the organiser code on the next Back press.
 *
 * The window is named per tournament: pressing the button again re-targets the
 * same window instead of stacking copies. Returns false when the browser
 * blocked it; the caller then offers a plain target=_blank link (a real link
 * click is never popup-blocked). No `noopener` feature on purpose — with it
 * window.open always returns null and a blocked window can't be detected.
 *
 * `tavle: true` opens the clean presentation view (`?visning=tavle`, no
 * organiser controls — see lib/client/storskjerm) in a window of its own, so a
 * plain board window and a presentation window don't hijack each other. */
const opened = new Map<string, Window>();

export function openBoardWindowRef(id: string, opts: { tavle?: boolean } = {}): Window | null {
  const name = opts.tavle ? `turnering-tavle-${id}-visning` : `turnering-tavle-${id}`;
  // Already open from this page: just bring it forward — re-opening by name
  // would reload the board (and drop its one-time sound unlock).
  const existing = opened.get(name);
  if (existing && !existing.closed) {
    try {
      existing.focus();
    } catch {}
    return existing;
  }
  const w = window.open(boardPath(id, opts.tavle), name, "popup,width=1280,height=800");
  if (!w) return null;
  opened.set(name, w);
  try {
    w.focus();
  } catch {}
  return w;
}

export function openBoardWindow(id: string): boolean {
  return openBoardWindowRef(id) !== null;
}

export function boardPath(id: string, tavle = false): string {
  const path = `/board/${id}`;
  return tavle ? tavleUrl(path) : path;
}
