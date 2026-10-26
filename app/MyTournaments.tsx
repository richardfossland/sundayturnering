"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { myTournaments, type MyTournament } from "@/lib/client/myTournaments";
import { no } from "@/lib/locale/no";

const COLLAPSED = 3;

// Landing-page list of the tournaments this device created — the way back to
// the organiser page (and its codes) after closing the tab. Renders nothing
// until storage has been read, and nothing at all when the list is empty.
export function MyTournaments() {
  const [list, setList] = useState<MyTournament[]>([]);
  const [all, setAll] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read device storage post-mount
    setList(myTournaments.list());
  }, []);

  if (list.length === 0) return null;

  const shown = all ? list : list.slice(0, COLLAPSED);

  return (
    <section className="role-mine" aria-labelledby="mine-title">
      <div className="stack" style={{ gap: "var(--sp-1)" }}>
        <h3 id="mine-title">{no.hub.mineTitle}</h3>
        <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>{no.hub.mineHint}</span>
      </div>
      <ul className="mine-list">
        {shown.map((t) => (
          <li key={t.id} className="mine-item">
            <Link href={`/arrangor/${t.id}`} className="mine-link">
              <strong>{t.title || no.hub.untitled}</strong>
              {t.createdAt && (
                <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>
                  {formatDate(t.createdAt)}
                </span>
              )}
            </Link>
            <button
              className="btn btn-ghost btn-sm"
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
      {list.length > COLLAPSED && (
        <button className="btn btn-ghost btn-sm" onClick={() => setAll((v) => !v)}>
          {all ? no.hub.mineShowLess : no.hub.mineShowAll(list.length)}
        </button>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
}
