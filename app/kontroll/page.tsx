"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/client/api";
import { pairErrorMessage } from "@/lib/locale/errors";
import { identity } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { SiteHeader, backToHome } from "@/lib/client/SiteHeader";
import { parseControlTarget, withControlTarget } from "@/lib/client/controlTarget";

function AttachInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read stored name post-mount
    setName(identity.deviceName());
  }, []);

  async function attach(c: string) {
    setBusy(true);
    setErr(null);
    try {
      const { tournament } = await api.attachControl(c);
      if (name.trim()) identity.setDeviceName(name.trim());
      // The code is the referee credential for every write on /kontroll/[id].
      identity.setControlCode(tournament.id, c);
      // Kampkort/banekort-QR: ta med kampen/banen videre til dommerskjermen.
      router.push(withControlTarget(`/kontroll/${tournament.id}`, parseControlTarget(params)));
    } catch (e) {
      setErr(pairErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <main className="center-screen">
      <div className="card stack entry-card">
        <div className="stack" style={{ gap: "var(--sp-3)" }}>
          <h1 style={{ fontSize: "var(--fs-xl)" }}>{no.pair.controlTitle}</h1>
          <p className="entry-lede">{no.pair.controlExplain}</p>
        </div>
        <div className="field">
          <label className="label" htmlFor="control-code">{no.pair.controlCodeLabel}</label>
          <input
            id="control-code"
            className="input code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && code.length === 6 && attach(code)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="device-name">{no.pair.deviceName}</label>
          <input
            id="device-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={no.pair.deviceNamePlaceholder}
          />
        </div>
        {err && <div className="toast-danger" role="alert" style={{ fontSize: "var(--fs-sm)" }}>{err}</div>}
        <button
          className="btn btn-gold btn-block btn-lg"
          disabled={busy || code.length !== 6}
          onClick={() => attach(code)}
        >
          {busy ? <span className="spin" /> : null}
          {busy ? no.pair.joining : no.pair.join}
        </button>
      </div>
    </main>
  );
}

export default function ControlAttach() {
  return (
    <>
      <SiteHeader back={backToHome} />
      <Suspense fallback={<main className="center-screen"><span className="spin" /></main>}>
        <AttachInner />
      </Suspense>
    </>
  );
}
