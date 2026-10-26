"use client";

import { useAutoReset } from "@/lib/client/useAutoReset";
import { no } from "@/lib/locale/no";

// Replaces the root layout, so no globals.css classes/tokens are guaranteed.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useAutoReset(reset);
  return (
    <html lang="no">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0f1218",
          color: "#f3efe6",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div>
          <p>{no.common.errorAuto}</p>
          <button
            onClick={reset}
            style={{
              padding: "10px 20px",
              border: 0,
              borderRadius: 12,
              background: "#ebb84b",
              color: "#14171e",
              fontWeight: 700,
              fontSize: "1rem",
              cursor: "pointer",
            }}
          >
            {no.common.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
