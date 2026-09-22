"use client";

import { useEffect, useState } from "react";
import { QRCode } from "@/lib/client/QRCode";
import { api, ApiError } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { normalizeWordCode } from "@/lib/codes";
import { no } from "@/lib/locale/no";

// Fullscreen overview of every code/link the organiser needs mid-event:
// referee control (code + deep link), public follow link and the board code
// for reopening this screen elsewhere.
//
// The codes are NOT in the public tournament state (anyone with a follow link
// can read that). They come from this device: stored at creation, by /tavle,
// or by the admin dashboard. A screen without them asks for the board code
// once. organiser_code is never shown here — it must not reach a projector.
export function CodesOverlay({
  tournamentId,
  baseUrl,
  onClose,
}: {
  tournamentId: string;
  baseUrl: string;
  onClose: () => void;
}) {
  // undefined = not read yet; null = this device doesn't hold them
  const [codes, setCodes] = useState<{ control: string; board: string | null } | null | undefined>(
    undefined,
  );
  const followUrl = `${baseUrl}/se/${tournamentId}`;
  const boardUrl = `${baseUrl}/tavle`;

  useEffect(() => {
    const control = identity.controlCode(tournamentId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read device storage post-mount
    setCodes(control ? { control, board: identity.boardCode(tournamentId) } : null);
  }, [tournamentId]);

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
        aria-modal="true"
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
          {codes ? (
            <section className="codes-card">
              <div className="board-code-label">{no.board.codesControl}</div>
              <div className="board-code">{codes.control}</div>
              <QRCode value={`${baseUrl}/kontroll?code=${codes.control}`} size={150} />
              <p className="faint codes-hint">{no.board.codesControlHint}</p>
              <CopyBtn value={`${baseUrl}/kontroll?code=${codes.control}`} />
            </section>
          ) : codes === null ? (
            <Unlock
              tournamentId={tournamentId}
              onUnlocked={(control, board) => setCodes({ control, board })}
            />
          ) : null}

          <section className="codes-card">
            <div className="board-code-label">{no.board.codesFollow}</div>
            <div className="codes-url">{followUrl.replace(/^https?:\/\//, "")}</div>
            <QRCode value={followUrl} size={150} />
            <p className="faint codes-hint">{no.board.codesFollowHint}</p>
            <CopyBtn value={followUrl} />
          </section>

          {codes?.board && (
            <section className="codes-card">
              <div className="board-code-label">{no.board.codesBoard}</div>
              <div className="board-code">{codes.board}</div>
              <QRCode value={boardUrl} size={150} />
              <p className="faint codes-hint">{no.board.codesBoardHint}</p>
              <CopyBtn value={boardUrl} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** Board code → control code for a screen that doesn't hold the codes yet. */
function Unlock({
  tournamentId,
  onUnlocked,
}: {
  tournamentId: string;
  onUnlocked: (control: string, board: string) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function unlock() {
    setBusy(true);
    setErr(null);
    try {
      const { tournament } = await api.attachBoard(normalizeWordCode(code));
      if (tournament.id !== tournamentId) {
        setErr(no.board.codesWrongBoard);
        return;
      }
      const board = tournament.board_code ?? normalizeWordCode(code);
      identity.setControlCode(tournamentId, tournament.control_code);
      identity.setBoardCode(tournamentId, board);
      onUnlocked(tournament.control_code, board);
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 404 ? no.pair.badCode : no.common.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="codes-card">
      <div className="board-code-label">{no.board.codesControl}</div>
      <strong>{no.board.codesLocked}</strong>
      <p className="faint codes-hint">{no.board.codesLockedHint}</p>
      <label className="sr-only" htmlFor="codes-board-code">
        {no.pair.boardCodeTitle}
      </label>
      <input
        id="codes-board-code"
        className="input code-input"
        style={{ letterSpacing: ".3em", textAlign: "center" }}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === "Enter" && code.trim() && !busy && unlock()}
        placeholder="KODE-XX"
        maxLength={7}
        autoComplete="off"
      />
      {err && (
        <div className="toast-danger" role="alert" style={{ fontSize: ".9rem" }}>
          {err}
        </div>
      )}
      <button className="btn btn-gold btn-block" onClick={unlock} disabled={busy || !code.trim()}>
        {busy ? <span className="spin" /> : null}
        {no.board.codesUnlock}
      </button>
    </section>
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
