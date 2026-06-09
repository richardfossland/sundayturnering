"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";

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
      router.push(`/kontroll/${tournament.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? no.pair.badCode : no.common.error);
      setBusy(false);
    }
  }

  return (
    <main className="center-screen">
      <div className="card card-pad stack" style={{ maxWidth: 420, width: "100%" }}>
        <div className="brand" style={{ justifyContent: "center" }}>
          <span className="brand-mark">T</span>
          {no.brand}
        </div>
        <h2 className="center">{no.pair.controlTitle}</h2>
        <input
          className="input code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && code.length === 6 && attach(code)}
        />
        <div className="field">
          <label className="label">{no.pair.deviceName}</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={no.pair.deviceNamePlaceholder}
          />
        </div>
        {err && <div className="toast-danger" style={{ fontSize: ".9rem" }}>{err}</div>}
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
    <Suspense fallback={<main className="center-screen"><span className="spin" /></main>}>
      <AttachInner />
    </Suspense>
  );
}
