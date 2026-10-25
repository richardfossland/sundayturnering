"use client";

/** Shown once two fetches in a row have failed. The last good state stays on
 * screen underneath — a projector must never go blank on flaky wifi. */
export function OfflineBanner({
  failures,
  lastOkAt,
}: {
  failures: number;
  lastOkAt: number | null;
}) {
  if (failures < 2) return null;
  const t = lastOkAt
    ? new Date(lastOkAt).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      {t ? `Frakoblet \u2013 sist oppdatert ${t}` : "Frakoblet \u2013 pr\u00f8ver \u00e5 koble til igjen"}
    </div>
  );
}
