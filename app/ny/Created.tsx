"use client";

import { useState } from "react";
import Link from "next/link";
import { no } from "@/lib/locale/no";

// Post-create screen: surface all three codes. The organiser_code is the
// important one — it gates destructive actions and is shown only here.
export function Created({
  result,
  onBoard,
}: {
  result: {
    id: string;
    control_code: string;
    board_code: string;
    organiser_code: string;
  };
  onBoard: () => void;
}) {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");
  return (
    <main className="center-screen">
      <div className="card card-pad stack center" style={{ maxWidth: 480, width: "100%" }}>
        <div className="champion-eyebrow">✓ Turnering opprettet</div>

        <CodeBlock label={no.pair.controlTitle} value={result.control_code} big />
        <div className="row" style={{ gap: 12 }}>
          <CodeBlock label="Tavlekode" value={result.board_code} />
          <CodeBlock label={no.control.organiserCode} value={result.organiser_code} warn />
        </div>
        <p className="faint" style={{ fontSize: ".85rem" }}>
          Ta vare på <b>arrangørkoden</b> — den kreves for å starte sluttspill,
          overstyre resultater og avslutte. Del bare kontrollkoden med dommerne.
        </p>

        <div className="stack" style={{ gap: 10, marginTop: 6 }}>
          <button className="btn btn-gold btn-lg btn-block" onClick={onBoard}>
            Åpne tavla på storskjerm
          </button>
          <Link href={`/kontroll?code=${result.control_code}`} className="btn btn-block">
            {no.landing.controlCta}
          </Link>
          <CopyLink
            label="📣 Del følge-lenke (publikum)"
            value={`${base}/live/${result.id}`}
          />
        </div>
      </div>
    </main>
  );
}

function CodeBlock({
  label,
  value,
  big,
  warn,
}: {
  label: string;
  value: string;
  big?: boolean;
  warn?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="board-code-card grow"
      style={{ cursor: "pointer", borderColor: warn ? "rgba(224,137,74,.45)" : undefined }}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
      title="Kopier"
    >
      <div className="board-code-label">{label}</div>
      <div
        className="board-code"
        style={{ fontSize: big ? "2.6rem" : "1.6rem", color: warn ? "var(--warn)" : undefined }}
      >
        {value}
      </div>
      <div className="faint" style={{ fontSize: ".72rem" }}>{copied ? "Kopiert!" : "trykk for å kopiere"}</div>
    </button>
  );
}

function CopyLink({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-block"
      onClick={() =>
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          },
          () => {},
        )
      }
    >
      {copied ? "Lenke kopiert!" : label}
    </button>
  );
}
