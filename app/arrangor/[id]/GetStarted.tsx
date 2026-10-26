"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CopyButton } from "@/lib/client/CopyButton";
import { Icon } from "@/lib/client/Icon";
import { no } from "@/lib/locale/no";
import { OpenBoardButton } from "./OpenBoardButton";

// «Kom i gang»: the first-time checklist. Shown while no match is finished,
// gone once the first result is in. Steps tick off as they are done on this
// device (opened the board, copied the code); step 3 is the real goal.
export function GetStarted({
  id,
  controlCode,
  boardOpened,
  codeCopied,
  onBoardOpened,
  onCodeCopied,
}: {
  id: string;
  controlCode: string | null;
  boardOpened: boolean;
  codeCopied: boolean;
  onBoardOpened: () => void;
  onCodeCopied: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="org-card get-started" aria-labelledby="start-title">
      <header className="spread">
        <div className="org-section-head">
          <h2 id="start-title" className="org-card-title">{no.hub.startTitle}</h2>
          <p className="org-section-intro">{no.hub.startIntro}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={open}
          aria-controls="start-steps"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "chevronUp" : "chevronDown"} />
          {open ? no.hub.startHide : no.hub.startShow}
        </button>
      </header>

      {open && (
        <ol id="start-steps" className="steps">
          <Step n={1} done={boardOpened} title={no.hub.step1Title} body={no.hub.step1Body}>
            <OpenBoardButton id={id} onOpened={onBoardOpened} />
          </Step>
          <Step n={2} done={codeCopied} title={no.hub.step2Title} body={no.hub.step2Body}>
            {controlCode ? (
              <div className="row wrap-gap">
                <output className="code-value">{controlCode}</output>
                <CopyButton value={controlCode} onCopied={onCodeCopied} />
              </div>
            ) : (
              <p className="hint">{no.hub.step2Missing}</p>
            )}
          </Step>
          <Step n={3} done={false} title={no.hub.step3Title} body={no.hub.step3Body}>
            <Link href={`/kontroll/${id}`} className="btn btn-gold">
              <Icon name="phone" />
              {no.hub.step3Cta}
            </Link>
          </Step>
          <Step n={4} optional title={no.hub.step4Title} body={no.hub.step4Body}>
            <Link href={`/skriv-ut/${id}`} className="btn">
              <Icon name="print" />
              {no.hub.step4Cta}
            </Link>
          </Step>
        </ol>
      )}
    </section>
  );
}

function Step({
  n,
  done = false,
  optional = false,
  title,
  body,
  children,
}: {
  n: number;
  done?: boolean;
  optional?: boolean;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <li className="step" data-done={done} data-optional={optional}>
      <span className="step-n" aria-hidden="true">
        {done ? <Icon name="check" size={16} strokeWidth={2.6} /> : n}
      </span>
      <div className="step-main">
        <h3 className="step-title">
          {title}
          {done && <span className="sr-only">. {no.hub.stepDone}</span>}
        </h3>
        <p className="step-body">{body}</p>
        <div className="step-act">{children}</div>
      </div>
    </li>
  );
}
