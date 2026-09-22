"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/client/api";
import { boardPath, openBoardWindow } from "@/lib/client/boardWindow";
import { myTournaments, type MyTournament } from "@/lib/client/myTournaments";
import { no } from "@/lib/locale/no";
import type { TournamentStatus } from "@/lib/types";

// The organiser's page for one tournament: all three codes + the ways in. It
// reads the codes from this device's "Mine turneringer" store (written at
// creation), so Back, reload and opening the board never lose them — the
// organiser code is shown only here and gates advance/override/finish.
export function OrganiserHub({ id }: { id: string }) {
  // undefined = not read yet (SSR + first paint), null = not on this device
  const [mine, setMine] = useState<MyTournament | null | undefined>(undefined);
  const [live, setLive] = useState<{ title: string; status: TournamentStatus } | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read device storage post-mount
    setMine(myTournaments.get(id));
    let cancelled = false;
    api.fetchState(id).then(
      (s) => {
        if (!cancelled) setLive({ title: s.tournament.title, status: s.tournament.status });
      },
      (e) => {
        if (!cancelled && e instanceof ApiError && e.status === 404) setGone(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (mine === undefined)
    return (
      <main className="center-screen">
        <span className="spin" />
      </main>
    );

  const title = live?.title || mine?.title || "";
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");

  return (
    <main className="center-screen">
      <div className="card card-pad stack center" style={{ maxWidth: 480, width: "100%" }}>
        <div className="champion-eyebrow">{no.hub.eyebrow}</div>
        {title && <h1 style={{ fontSize: "1.5rem" }}>{title}</h1>}
        {live && (
          <div className="faint" style={{ fontSize: ".85rem", marginTop: -8 }}>
            {no.admin.status[live.status]}
          </div>
        )}

        {gone && (
          <div className="panel" role="alert">
            {no.hub.gone}
          </div>
        )}

        {mine ? (
          <>
            <CodeBlock label={no.hub.controlCode} value={mine.control_code} big />
            <div className="row" style={{ gap: 12 }}>
              <CodeBlock label={no.hub.boardCode} value={mine.board_code} />
              <CodeBlock label={no.control.organiserCode} value={mine.organiser_code} warn />
            </div>
            <p className="faint" style={{ fontSize: ".85rem" }}>
              {no.hub.organiserNote}
            </p>
          </>
        ) : (
          <div className="panel stack" style={{ gap: 8, textAlign: "left" }}>
            <strong>{no.hub.missingTitle}</strong>
            <span className="faint" style={{ fontSize: ".9rem" }}>{no.hub.missingBody}</span>
          </div>
        )}

        {!gone && (
          <div className="stack" style={{ gap: 10, marginTop: 6 }}>
            <OpenBoardButton id={id} />
            {mine ? (
              <Link href={`/kontroll/${id}`} className="btn btn-block">
                {no.hub.control}
              </Link>
            ) : (
              <>
                <Link href="/tavle" className="btn btn-block">
                  {no.landing.boardCta}
                </Link>
                <Link href="/kontroll" className="btn btn-block">
                  {no.landing.controlCta}
                </Link>
              </>
            )}
            {/* Same link the board's QR points at: the phone view with
                tap-to-cheer (/se), not the projector layout (/live). */}
            <CopyLink label={no.hub.follow} value={`${base}/se/${id}`} />
            <Link href={`/resultat/${id}`} className="btn btn-ghost btn-block">
              {no.hub.results}
            </Link>
          </div>
        )}

        {mine && <p className="faint" style={{ fontSize: ".8rem" }}>{no.hub.savedNote}</p>}
        <Link href="/" className="faint" style={{ fontSize: ".9rem" }}>
          {no.hub.toLanding}
        </Link>
      </div>
    </main>
  );
}

function OpenBoardButton({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "opened" | "blocked">("idle");
  return (
    <div className="stack" style={{ gap: 8 }}>
      <button
        className="btn btn-gold btn-lg btn-block"
        onClick={() => setState(openBoardWindow(id) ? "opened" : "blocked")}
      >
        {no.hub.openBoard}
      </button>
      {state === "opened" && (
        <span className="faint" style={{ fontSize: ".85rem" }} role="status">
          {no.hub.boardOpened}
        </span>
      )}
      {state === "blocked" && (
        <div className="panel stack" style={{ gap: 8 }} role="alert">
          <span>{no.hub.boardBlocked}</span>
          <a className="btn btn-block" href={boardPath(id)} target="_blank" rel="noopener">
            {no.hub.boardBlockedLink}
          </a>
        </div>
      )}
    </div>
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
      <div className="faint" style={{ fontSize: ".72rem" }}>
        {copied ? no.hub.copied : no.hub.copy}
      </div>
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
      {copied ? no.hub.followCopied : label}
    </button>
  );
}
