"use client";

import { no } from "@/lib/locale/no";

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
      {t ? no.common.offlineSince(t) : no.common.offlineRetrying}
    </div>
  );
}
