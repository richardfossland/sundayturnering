"use client";

import { useState } from "react";
import { boardPath, openBoardWindow } from "@/lib/client/boardWindow";
import { Icon } from "@/lib/client/Icon";
import { no } from "@/lib/locale/no";

// Opens the storskjerm in its own named window (see lib/client/boardWindow.ts)
// and, when the browser blocks the popup, offers a plain link instead — a real
// link click is never blocked.
export function OpenBoardButton({
  id,
  primary = false,
  onOpened,
}: {
  id: string;
  /** The big gold button in the page header; otherwise a plain button. */
  primary?: boolean;
  onOpened?: () => void;
}) {
  const [state, setState] = useState<"idle" | "opened" | "blocked">("idle");
  return (
    <div className="board-launch">
      <button
        type="button"
        className={primary ? "btn btn-gold btn-lg" : "btn"}
        onClick={() => {
          const ok = openBoardWindow(id);
          setState(ok ? "opened" : "blocked");
          if (ok) onOpened?.();
        }}
      >
        <Icon name="screen" size={primary ? 20 : 18} />
        {no.hub.openBoard}
      </button>
      {state === "opened" && (
        <p className="hint" role="status">{no.hub.boardOpened}</p>
      )}
      {state === "blocked" && (
        <div className="panel board-launch-blocked" role="alert">
          <span>{no.hub.boardBlocked}</span>
          <a className="btn" href={boardPath(id)} target="_blank" rel="noopener" onClick={onOpened}>
            <Icon name="external" />
            {no.hub.boardBlockedLink}
          </a>
        </div>
      )}
    </div>
  );
}
