"use client";

import { useState } from "react";
import { CopyButton } from "@/lib/client/CopyButton";
import { Icon } from "@/lib/client/Icon";
import { no } from "@/lib/locale/no";

// The three codes, one row per ROLE: who gets it and what it does. Each row
// copes with its code being absent (it lives only on the device that created
// the tournament).

export function CodesSection({
  controlCode,
  boardCode,
  organiserCode,
  organiserRemovable,
  onOrganiserCode,
  onCopiedControl,
}: {
  controlCode: string | null;
  boardCode: string | null;
  organiserCode: string;
  organiserRemovable: boolean;
  onOrganiserCode: (c: string) => void;
  onCopiedControl?: () => void;
}) {
  return (
    <section className="org-card" aria-labelledby="codes-title">
      <header className="org-section-head">
        <h2 id="codes-title" className="org-card-title">{no.hub.codesTitle}</h2>
        <p className="org-section-intro">{no.hub.codesIntro}</p>
      </header>
      <ul className="code-list">
        <CodeRow
          role={no.hub.controlRole}
          name={no.hub.controlCode}
          body={no.hub.controlBody}
          code={controlCode}
          onCopied={onCopiedControl}
          big
        />
        <CodeRow role={no.hub.boardRole} name={no.hub.boardCode} body={no.hub.boardBody} code={boardCode} />
        <OrganiserRow code={organiserCode} removable={organiserRemovable} onChange={onOrganiserCode} />
      </ul>
    </section>
  );
}

function CodeRow({
  role,
  name,
  body,
  code,
  big,
  onCopied,
}: {
  role: string;
  name: string;
  body: string;
  code: string | null;
  big?: boolean;
  onCopied?: () => void;
}) {
  return (
    <li className="code-row">
      <div className="code-info">
        <span className="code-role">{role}</span>
        <h3 className="code-name">{name}</h3>
        <p className="code-body">{body}</p>
      </div>
      <div className="code-value-col">
        {code ? (
          <>
            <output className={`code-value${big ? " code-value-big" : ""}`}>{code}</output>
            <CopyButton
              value={code}
              aria-label={`${no.hub.copy} ${name.toLowerCase()}`}
              onCopied={onCopied}
            />
          </>
        ) : (
          <p className="hint">{no.hub.codeNotHere}</p>
        )}
      </div>
    </li>
  );
}

/** The private one: hidden until asked for, marked as «Privat», and — when the
 * device does not hold it — the place to type it in to unlock the tools. */
function OrganiserRow({
  code,
  removable,
  onChange,
}: {
  code: string;
  /** Typed in on this device (not the creating one): may be cleared again. */
  removable: boolean;
  onChange: (c: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <li className="code-row code-row-private">
      <div className="code-info">
        <span className="code-role code-role-private">
          <Icon name="lock" size={14} />
          {no.hub.organiserRole}
        </span>
        <h3 className="code-name">{no.control.organiserCode}</h3>
        <p className="code-body">{no.hub.organiserBody}</p>
      </div>
      <div className="code-value-col">
        {code ? (
          <>
            <output className="code-value" aria-label={shown ? undefined : no.control.organiserCode}>
              {shown ? code : "••••••"}
            </output>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-ghost"
                aria-pressed={shown}
                onClick={() => setShown((v) => !v)}
              >
                <Icon name={shown ? "eyeOff" : "eye"} />
                {shown ? no.hub.hide : no.hub.reveal}
              </button>
              <CopyButton value={code} aria-label={`${no.hub.copy} ${no.control.organiserCode.toLowerCase()}`} />
            </div>
            {removable && (
              <button type="button" className="link-btn" onClick={() => onChange("")}>
                {no.hub.unlockClear}
              </button>
            )}
          </>
        ) : (
          <form
            className="unlock-form"
            onSubmit={(e) => {
              e.preventDefault();
              const c = draft.trim();
              if (c) onChange(c);
            }}
          >
            <strong>{no.hub.unlockTitle}</strong>
            <p className="hint">{no.hub.unlockBody}</p>
            <input
              className="input"
              aria-label={no.control.organiserCode}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={no.hub.unlockPlaceholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value.toUpperCase())}
            />
            <button type="submit" className="btn btn-gold" disabled={!draft.trim()}>
              {no.hub.unlockSave}
            </button>
          </form>
        )}
      </div>
    </li>
  );
}
