"use client";

import { useAutoReset } from "@/lib/client/useAutoReset";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useAutoReset(reset);
  return (
    <main className="center-screen">
      <div className="empty stack" style={{ alignItems: "center", gap: 14 }}>
        <div>Noe gikk galt. Prøver igjen automatisk om litt…</div>
        <button className="btn btn-gold" onClick={reset}>
          Prøv igjen
        </button>
      </div>
    </main>
  );
}
