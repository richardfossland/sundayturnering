"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { no } from "@/lib/locale/no";

// A button that copies `value` to the clipboard and says so for a moment.
// Silent when the browser refuses (insecure context, denied permission): the
// value is always visible next to it, so nothing is lost.
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
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            onCopied?.();
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1600);
          },
          () => {},
        );
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}
