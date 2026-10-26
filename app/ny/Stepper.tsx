"use client";

import { useState } from "react";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";

// The wizard's named steps. The count is FIXED (7): a step the chosen format
// doesn't need (Sluttspill for a plain league) stays in the row, greyed out as
// «Ikke nødvendig», so «av 7» never changes under the user's feet. Finished
// steps are buttons that jump back; on a phone the row collapses to
// «Steg 3 av 7 · Poeng» + a progress bar that opens the same list.

type State = "done" | "current" | "todo" | "skipped";

export function Stepper({
  step,
  skipped,
  onGo,
}: {
  step: number;
  /** Step numbers that don't apply to the chosen format. */
  skipped: number[];
  onGo: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const names = no.wizard.stepNames;
  const total = names.length;
  const stateOf = (n: number): State =>
    skipped.includes(n) ? "skipped" : n === step ? "current" : n < step ? "done" : "todo";

  return (
    <nav aria-label={no.wizard.stepsLabel}>
      <ol className="stepper">
        {names.map((name, i) => {
          const n = i + 1;
          const st = stateOf(n);
          const body = (
            <>
              <span className="stepper-dot">{st === "done" ? <Icon name="check" size={16} strokeWidth={3} /> : n}</span>
              <span className="stepper-label">{name}</span>
              {st === "skipped" && <span className="stepper-sub">{no.wizard.stepSkipped}</span>}
            </>
          );
          return (
            <li key={name} className="stepper-item" data-state={st} aria-current={st === "current" ? "step" : undefined}>
              {st === "done" ? (
                <button type="button" className="stepper-btn" aria-label={no.wizard.stepGoTo(name)} onClick={() => onGo(n)}>
                  {body}
                </button>
              ) : (
                <span className="stepper-btn">{body}</span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="stepper-compact">
        <button
          type="button"
          className="stepper-compact-btn"
          aria-expanded={open}
          aria-controls="stepper-list"
          onClick={() => setOpen((o) => !o)}
        >
          <span>{no.wizard.stepCompact(step, total, names[step - 1])}</span>
          <Icon name="chevronDown" size={18} />
        </button>
        <div className="stepper-bar" aria-hidden="true">
          {names.map((name, i) => (
            <span key={name} data-on={i + 1 <= step} />
          ))}
        </div>
        {open && (
          <ol className="stepper-list" id="stepper-list">
            {names.map((name, i) => {
              const n = i + 1;
              const st = stateOf(n);
              return (
                <li key={name}>
                  {st === "done" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onGo(n);
                      }}
                    >
                      <Icon name="check" size={16} strokeWidth={3} />
                      {name}
                    </button>
                  ) : (
                    <span
                      aria-current={st === "current" ? "step" : undefined}
                      data-skipped={st === "skipped" ? "true" : undefined}
                    >
                      {name}
                      {st === "skipped" && <span className="stepper-sub">{no.wizard.stepSkipped}</span>}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </nav>
  );
}
