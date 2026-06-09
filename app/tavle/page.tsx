"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { no } from "@/lib/locale/no";

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
      router.push(`/board/${tournament.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? no.pair.badCode : no.common.error);
      setBusy(false);
    }
  }

  return (
    <main className="center-screen">
      <div className="card card-pad stack" style={{ maxWidth: 420, width: "100%" }}>
        <h2>{no.pair.boardCodeTitle}</h2>
        <input
          className="input code-input"
          style={{ letterSpacing: ".3em", fontSize: "1.5rem" }}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="KODE-XX"
          maxLength={7}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
        {err && <div className="toast-danger" style={{ fontSize: ".9rem" }}>{err}</div>}
        <button className="btn btn-gold btn-block btn-lg" onClick={go} disabled={busy}>
          {busy ? <span className="spin" /> : null}
          {no.board.standings}
        </button>
      </div>
    </main>
  );
}
