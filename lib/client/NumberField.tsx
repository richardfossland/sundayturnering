"use client";

import { useRef, useState } from "react";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import {
  commitDraft,
  draftHint,
  liveValue,
  parseDraft,
  sanitizeDraft,
} from "@/lib/client/numberDraft";

// A whole-number input that is easy to TYPE into. It edits a local text draft
// and only settles on a clamped value when the field is left (blur / Enter):
// clearing "2" and typing "3" gives 3 (the old per-keystroke clamp gave 12),
// and "02" can't happen. While typing, onChange fires only for drafts already
// inside [min, max]; an out-of-range draft shows «Maks 12» / «Minst 2» instead
// of jumping.

interface Props {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  id?: string;
  /** Names the field for assistive tech (and the − / + buttons). */
  "aria-label"?: string;
  /** Unit shown after the box, e.g. "min". */
  suffix?: string;
  /** No − / + buttons, smaller box (score inputs, dense rows). */
  compact?: boolean;
  disabled?: boolean;
  /** Called after Enter has committed the draft. */
  onEnter?: (n: number) => void;
  className?: string;
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  id,
  "aria-label": ariaLabel,
  suffix,
  compact = false,
  disabled = false,
  onEnter,
  className,
}: Props) {
  const allowNegative = min < 0;
  // null = not being edited: the box shows the external value, so a change
  // from outside (a − / + tap, a template load, a parent clamp) always shows.
  const [draft, setDraft] = useState<string | null>(null);
  const justFocused = useRef(false);
  const shown = draft ?? String(value);

  const hint = draft === null ? null : draftHint(draft, min, max, no.field);

  function commit(): number {
    const text = draft ?? String(value);
    const n = commitDraft(text, min, max);
    if (n !== value) onChange(n);
    setDraft(null);
    return n;
  }

  function step(delta: number) {
    // A tap on − / + blurs the box first (which commits), so `value` is current.
    const base = draft !== null ? (parseDraft(draft) ?? value) : value;
    const n = Math.min(max, Math.max(min, base + delta));
    setDraft(null);
    if (n !== value) onChange(n);
  }

  const stepper = !compact;
  const label = ariaLabel ? ` ${ariaLabel.toLowerCase()}` : "";

  return (
    <div className={`numfield${compact ? " numfield-compact" : ""}${className ? ` ${className}` : ""}`} data-invalid={hint ? "true" : undefined}>
      <div className="numfield-row">
        {stepper && (
          <button
            type="button"
            className="numfield-step"
            aria-label={`${no.field.less}${label}`}
            disabled={disabled || value <= min}
            onClick={() => step(-1)}
          >
            <Icon name="less" size={18} />
          </button>
        )}
        <input
          id={id}
          className="input numfield-input"
          type="text"
          inputMode={allowNegative ? "text" : "numeric"}
          pattern={allowNegative ? "-?[0-9]*" : "[0-9]*"}
          autoComplete="off"
          enterKeyHint="done"
          aria-label={ariaLabel}
          aria-invalid={hint ? true : undefined}
          disabled={disabled}
          value={shown}
          onFocus={(e) => {
            justFocused.current = true;
            setDraft(String(value));
            e.currentTarget.select();
          }}
          // Browsers collapse the selection on the mouseup that follows the
          // focusing click; keep «select all» for that first click only.
          onMouseUp={(e) => {
            if (justFocused.current) e.preventDefault();
            justFocused.current = false;
          }}
          onChange={(e) => {
            const next = sanitizeDraft(e.target.value, allowNegative);
            setDraft(next);
            const n = liveValue(next, min, max);
            if (n !== null && n !== value) onChange(n);
          }}
          onBlur={() => {
            justFocused.current = false;
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const n = commit();
              onEnter?.(n);
            } else if (e.key === "ArrowUp" && stepper) {
              e.preventDefault();
              step(1);
            } else if (e.key === "ArrowDown" && stepper) {
              e.preventDefault();
              step(-1);
            }
          }}
        />
        {stepper && (
          <button
            type="button"
            className="numfield-step"
            aria-label={`${no.field.more}${label}`}
            disabled={disabled || value >= max}
            onClick={() => step(1)}
          >
            <Icon name="more" size={18} />
          </button>
        )}
        {suffix && <span className="numfield-suffix">{suffix}</span>}
      </div>
      <span className="numfield-hint" role="status" aria-live="polite">
        {hint}
      </span>
    </div>
  );
}
