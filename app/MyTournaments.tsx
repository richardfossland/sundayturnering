"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { myTournaments, type MyTournament } from "@/lib/client/myTournaments";
import { no } from "@/lib/locale/no";

// Landing-page list of the tournaments this device created — the way back to
// the organiser page (and its codes) after closing the tab. Renders nothing
// until storage has been read, and nothing at all when the list is empty.
export function MyTournaments() {
  const [list, setList] = useState<MyTournament[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read device storage post-mount
    setList(myTournaments.list());
  }, []);

  if (list.length === 0) return null;

  return (
    <section className="stack" style={{ gap: 10, marginTop: 28, textAlign: "left" }}>
      <div className="spread">
        <h2 style={{ fontSize: "1.15rem" }}>{no.hub.mineTitle}</h2>
        <span className="faint" style={{ fontSize: ".8rem" }}>{no.hub.mineHint}</span>
      </div>
      <ul className="stack" style={{ gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
        {list.map((t) => (
          <li key={t.id} className="panel spread" style={{ padding: "10px 12px", gap: 10 }}>
            <Link href={`/arrangor/${t.id}`} className="grow" style={{ minWidth: 0 }}>
              <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.title || no.hub.untitled}
              </strong>
              {t.createdAt && (
                <span className="faint" style={{ fontSize: ".8rem" }}>
                  {formatDate(t.createdAt)}
                </span>
              )}
            </Link>
            <button
              className="btn btn-ghost"
              style={{ padding: "8px 12px", fontSize: ".85rem" }}
              aria-label={`${no.hub.forget}: ${t.title || no.hub.untitled}`}
              onClick={() => {
                if (!window.confirm(no.hub.forgetConfirm)) return;
                myTournaments.forget(t.id);
                setList(myTournaments.list());
              }}
            >
              {no.hub.forget}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
}
