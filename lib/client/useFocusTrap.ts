"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Modal focus management: focus the first field on mount, keep Tab/Shift+Tab
 * inside the container, and hand focus back to whatever opened it on unmount.
 * Attach the returned ref to the dialog element. `initial = "dialog"` focuses
 * the dialog itself instead (give it tabIndex={-1}) — for sheets on a phone,
 * where focusing a number field would pop the keyboard over the buttons. */
export function useFocusTrap<T extends HTMLElement>(initial: "field" | "dialog" = "field") {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement as HTMLElement | null;
    const items = () =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    // Prefer a text-ish field (the score input) over the close button.
    const first =
      initial === "dialog"
        ? null
        : (root.querySelector<HTMLElement>("input:not([disabled]),textarea:not([disabled])") ??
          items()[0]);
    (first ?? root).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const head = list[0];
      const tail = list[list.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        head.focus();
      } else if (e.shiftKey && active === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && active === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Opener may have unmounted (e.g. the card re-rendered away): then no-op.
      if (opener && document.contains(opener)) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);
  return ref;
}
