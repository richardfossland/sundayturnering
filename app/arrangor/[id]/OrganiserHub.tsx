"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { myTournaments, type MyTournament } from "@/lib/client/myTournaments";
import { useTournament } from "@/lib/client/useTournament";
import { useToast } from "@/lib/client/useToast";
import { teamMap } from "@/lib/client/view";
import { CopyButton } from "@/lib/client/CopyButton";
import { Icon } from "@/lib/client/Icon";
import { CourtsSection } from "@/lib/client/organiser/CourtsSection";
import { OverrideSection } from "@/lib/client/organiser/OverrideSection";
import { ShiftSection } from "@/lib/client/organiser/ShiftSection";
import { TimerSection } from "@/lib/client/organiser/TimerSection";
import { TournamentSection } from "@/lib/client/organiser/TournamentSection";
import { useGuard, useOrganiserCode, type ToolsCtx } from "@/lib/client/organiser/shared";
import { no } from "@/lib/locale/no";
import { CodesSection } from "./CodesSection";
import { GetStarted } from "./GetStarted";
import { OpenBoardButton } from "./OpenBoardButton";

// Kontrollsenter: the organiser's home for one tournament. Top: what it is and
// the one big action (storskjerm). Then «Kom i gang» until the first result,
// the three codes explained by role, and every organiser tool in titled
// sections. The codes come from this device's "Mine turneringer" store (written
// at creation) so Back, reload and opening the board never lose them; the
// organiser code is the credential every tool below sends, exactly as the
// referee page's panel does. State stays live through useTournament.
export function OrganiserHub({ id }: { id: string }) {
  // undefined = not read yet (SSR + first paint), null = not on this device
  const [mine, setMine] = useState<MyTournament | null | undefined>(undefined);
  const [heldControl, setHeldControl] = useState<string | null>(null);
  const [heldBoard, setHeldBoard] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [boardOpened, setBoardOpened] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const { state, error, refetch } = useTournament(id);
  const { flash, region } = useToast();
  const { code, setCode } = useOrganiserCode(id, mine?.organiser_code ?? "");
  const { busy, guard } = useGuard(refetch, flash);
  const teams = useMemo(() => teamMap(state?.teams ?? []), [state?.teams]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- read device storage post-mount */
    const m = myTournaments.get(id);
    setMine(m);
    setHeldControl(m?.control_code ?? identity.controlCode(id));
    setHeldBoard(m?.board_code ?? identity.boardCode(id));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [id]);

  // useTournament only says "failed"; ask once more whether it is gone for good.
  const failedWithoutState = error && !state;
  useEffect(() => {
    if (!failedWithoutState) return;
    let cancelled = false;
    api.fetchState(id).catch((e) => {
      if (!cancelled && e instanceof ApiError && e.status === 404) setGone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id, failedWithoutState]);

  if (gone)
    return (
      <main className="org-hub">
        <div className="org-hub-in">
          <div className="panel" role="alert">{no.hub.gone}</div>
        </div>
      </main>
    );
  if (failedWithoutState)
    return (
      <main className="org-hub">
        <div className="org-hub-in stack">
          <div className="panel" role="alert">{no.hub.loadFailed}</div>
          <div><button type="button" className="btn" onClick={refetch}>{no.common.retry}</button></div>
        </div>
      </main>
    );
  if (mine === undefined || !state)
    return (
      <main className="center-screen">
        <span className="spin" />
      </main>
    );

  const { tournament, matches, courts } = state;
  const played = matches.filter((m) => m.status !== "bye");
  const doneCount = played.filter((m) => m.status === "done").length;
  const title = tournament.title || mine?.title || "";
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const ctx: ToolsCtx = {
    tournament,
    matches,
    teams,
    courts,
    code,
    busy,
    guard,
    flash,
    onChanged: refetch,
  };

  const codes = (
    <>
      <CodesSection
        controlCode={heldControl}
        boardCode={heldBoard}
        organiserCode={code}
        organiserRemovable={!mine}
        onOrganiserCode={setCode}
        onCopiedControl={() => setCodeCopied(true)}
      />
      {!mine && !code && (
        <div className="panel stack stack-tight" role="note">
          <strong>{no.hub.missingTitle}</strong>
          <span className="hint">{no.hub.missingBody}</span>
        </div>
      )}
    </>
  );

  return (
    <main className="org-hub">
      <div className="org-hub-in">
        <header className="hub-head">
          <div className="hub-head-text">
            <div className="hub-eyebrow">{no.hub.eyebrow}</div>
            {title && <h1 className="hub-title">{title}</h1>}
            <div className="hub-meta">
              <span className="pill pill-gold">{no.admin.status[tournament.status]}</span>
              {played.length > 0 && (
                <span className="faint">{no.hub.progress(doneCount, played.length)}</span>
              )}
            </div>
          </div>
          <OpenBoardButton id={id} primary onOpened={() => setBoardOpened(true)} />
        </header>

        {doneCount === 0 && tournament.status !== "finished" && (
          <GetStarted
            id={id}
            controlCode={heldControl}
            boardOpened={boardOpened}
            codeCopied={codeCopied}
            onBoardOpened={() => setBoardOpened(true)}
            onCodeCopied={() => setCodeCopied(true)}
          />
        )}

        {doneCount === 0 && codes}

        <h2 className="hub-tools-title">{no.hub.toolsTitle}</h2>
        {!code && <p className="hint">{no.hub.toolsLocked}</p>}
        <div className="hub-grid">
          {courts.length > 0 && <CourtsSection {...ctx} />}
          {tournament.config?.schedule && <ShiftSection {...ctx} />}
          <TimerSection {...ctx} />
          <TournamentSection {...ctx} />
          <div className="hub-wide">
            <OverrideSection {...ctx} />
          </div>
        </div>

        {/* Once matches are being played the tools matter more than the
            codes, so the codes move below them. */}
        {doneCount > 0 && codes}

        <section className="org-card" aria-labelledby="links-title">
          <header className="org-section-head">
            <h2 id="links-title" className="org-card-title">{no.hub.linksTitle}</h2>
            <p className="org-section-intro">{no.hub.linksIntro}</p>
          </header>
          <div className="link-grid">
            <Link href={`/kontroll/${id}`} className="btn">
              <Icon name="phone" />
              {no.hub.controlLink}
            </Link>
            <Link href={`/resultat/${id}`} className="btn">
              <Icon name="trophy" />
              {no.hub.results}
            </Link>
            <Link href={`/skriv-ut/${id}`} className="btn">
              <Icon name="print" />
              {no.hub.print}
            </Link>
            {/* Same link the board's QR points at: the phone view with
                tap-to-cheer (/se), not the projector layout (/live). */}
            <CopyButton
              className="btn"
              value={`${base}/se/${id}`}
              label={no.hub.follow}
              copiedLabel={no.hub.followCopied}
            />
          </div>
          <p className="hint">{no.hub.followHint}</p>
        </section>

        {mine && <p className="hint">{no.hub.savedNote}</p>}
      </div>
      {region}
    </main>
  );
}
