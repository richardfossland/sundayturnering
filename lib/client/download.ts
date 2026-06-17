"use client";

/** Trigger a client-side file download (CSV export etc.). A UTF-8 BOM is
 * prepended so Excel opens Norwegian characters correctly. */
export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿" + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Filesystem-safe slug for a tournament title. */
export function safeFilename(title: string, fallback = "turnering"): string {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9æøå]+/gi, "-")
      .replace(/^-+|-+$/g, "") || fallback;
  return base;
}
