"use client";

import { useEffect, useState } from "react";
import { QRCode } from "@/lib/client/QRCode";
import { no } from "@/lib/locale/no";
import type { TournamentDTO } from "@/lib/dto";

// Fullscreen overview of every code/link the organiser needs mid-event:
// referee control (code + deep link), public follow link and the board code
// for reopening this screen elsewhere. organiser_code is never in the DTO —
// it must not appear on a projector.
export function CodesOverlay({
  tournament,
  baseUrl,
  onClose,
}: {
  tournament: TournamentDTO;
  baseUrl: string;
  onClose: () => void;
}) {
  const controlUrl = `${baseUrl}/kontroll?code=${tournament.control_code}`;
  const followUrl = `${baseUrl}/se/${tournament.id}`;
  const boardUrl = `${baseUrl}/tavle`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="modal codes-modal card card-pad"
        role="dialog"
        aria-label={no.board.codesTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spread" style={{ marginBottom: 14 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            {no.board.codesTitle}
          </div>
          <button className="btn" onClick={onClose}>
            {no.common.close} ✕
          </button>
        </div>

        <div className="codes-grid">
          <section className="codes-card">
            <div className="board-code-label">{no.board.codesControl}</div>
            <div className="board-code">{tournament.control_code}</div>
            <QRCode value={controlUrl} size={150} />
            <p className="faint codes-hint">{no.board.codesControlHint}</p>
            <CopyBtn value={controlUrl} />
          </section>

          <section className="codes-card">
            <div className="board-code-label">{no.board.codesFollow}</div>
            <div className="codes-url">{followUrl.replace(/^https?:\/\//, "")}</div>
            <QRCode value={followUrl} size={150} />
            <p className="faint codes-hint">{no.board.codesFollowHint}</p>
            <CopyBtn value={followUrl} />
          </section>

          <section className="codes-card">
            <div className="board-code-label">{no.board.codesBoard}</div>
            <div className="board-code">{tournament.board_code}</div>
            <QRCode value={boardUrl} size={150} />
            <p className="faint codes-hint">{no.board.codesBoardHint}</p>
            <CopyBtn value={boardUrl} />
          </section>
        </div>
      </div>
    </div>
  );
}

function CopyBtn({ value }: { value: string }) {
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
      {copied ? no.board.codesCopied : no.board.codesCopy}
    </button>
  );
}
