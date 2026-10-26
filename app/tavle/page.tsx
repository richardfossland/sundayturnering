"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { pairErrorMessage } from "@/lib/locale/errors";
import { identity } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { SiteHeader, backToHome } from "@/lib/client/SiteHeader";

export default function BoardEntry() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const { tournament } = await api.attachBoard(code);
      // The board's codes overlay reads these from the device — the public
      // state endpoint doesn't carry them.
      identity.setControlCode(tournament.id, tournament.control_code);
      identity.setBoardCode(tournament.id, tournament.board_code ?? null);
      router.push(`/board/${tournament.id}`);
    } catch (e) {
      setErr(pairErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <SiteHeader back={backToHome} />
      <main className="center-screen">
        <div className="card stack entry-card">
          <div className="stack" style={{ gap: "var(--sp-3)" }}>
            <h1 style={{ fontSize: "var(--fs-xl)" }}>{no.pair.boardCodeTitle}</h1>
            <p className="entry-lede">{no.pair.boardExplain}</p>
          </div>
          <div className="field">
            <label className="label" htmlFor="board-code">{no.pair.boardCodeLabel}</label>
            <input
              id="board-code"
              className="input code-input"
              style={{ letterSpacing: ".3em", fontSize: "1.5rem" }}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="KODE-XX"
              maxLength={7}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && go()}
            />
          </div>
          {err && <div className="toast-danger" role="alert" style={{ fontSize: "var(--fs-sm)" }}>{err}</div>}
          <button className="btn btn-gold btn-block btn-lg" onClick={go} disabled={busy || !code.trim()}>
            {busy ? <span className="spin" /> : null}
            {no.landing.boardCta}
          </button>
        </div>
      </main>
    </>
  );
}
