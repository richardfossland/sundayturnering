"use client";

import { useAutoReset } from "@/lib/client/useAutoReset";
import { no } from "@/lib/locale/no";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useAutoReset(reset);
  return (
    <main className="center-screen">
      <div className="empty stack" style={{ alignItems: "center", gap: 14 }}>
        <div>{no.common.errorAuto}</div>
        <button className="btn btn-gold" onClick={reset}>
          {no.common.retry}
        </button>
      </div>
    </main>
  );
}
