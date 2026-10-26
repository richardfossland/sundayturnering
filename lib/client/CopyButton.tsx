"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { no } from "@/lib/locale/no";

/** Clipboard API first; the old select-and-copy trick when the browser has no
 * (or refuses the) async API, e.g. a page opened over plain http on the LAN. */
async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.className = "sr-only";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

// A button that copies `value` to the clipboard and says so for a moment.
// Silent when every route fails: the value is always visible next to it, so
// nothing is lost.
export function CopyButton({
  value,
  label = no.hub.copy,
  copiedLabel = no.hub.copied,
  className = "btn",
  "aria-label": ariaLabel,
  onCopied,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  "aria-label"?: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      onClick={async () => {
        if (!(await copyText(value))) return;
        setCopied(true);
        onCopied?.();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}
