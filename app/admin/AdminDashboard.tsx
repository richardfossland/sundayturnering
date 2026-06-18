"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { api, ApiError } from "@/lib/client/api";
import { createAuthBrowserClient } from "@/lib/supabase/auth-browser";
import { no } from "@/lib/locale/no";
import type { OrganiserTournamentRow } from "@/lib/server/store";

const STATUS = no.admin.status;

// Logged-in organiser dashboard: lists the admin's own tournaments and offers
// per-row management (open board/control, edit title/sport, reopen when
// finished, delete with confirm). All actions hit session-gated routes — the
// organiser code is never needed here.
export function AdminDashboard({
  initial,
}: {
  initial: OrganiserTournamentRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<OrganiserTournamentRow[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setRows(await api.listMyTournaments());
    } catch {
      setError(no.admin.loadError);
    }
  }

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? no.admin.actionError : no.common.error);
    } finally {
      setBusyId(null);
    }
  }

  function onReopen(t: OrganiserTournamentRow) {
    void withBusy(t.id, async () => {
      await api.reopenTournament(t.id);
      await refresh();
    });
  }

  function onDelete(t: OrganiserTournamentRow) {
    if (!window.confirm(no.admin.deleteConfirm(t.title || t.sport_label || t.id)))
      return;
    void withBusy(t.id, async () => {
      await api.deleteTournament(t.id);
      setRows((r) => r.filter((x) => x.id !== t.id));
    });
  }

  async function signOut() {
    try {
      await createAuthBrowserClient().auth.signOut();
    } finally {
      router.replace("/admin/login");
    }
  }

  return (
    <main className="center-screen" style={{ alignItems: "start" }}>
      <div className="stack" style={{ maxWidth: 720, width: "100%" }}>
        <div className="spread wrap-gap">
          <div className="stack" style={{ gap: 4 }}>
            <h1 className="brand" style={{ fontSize: "1.8rem" }}>
              {no.admin.title}
            </h1>
            <p className="faint">{no.admin.lede}</p>
          </div>
          <button className="btn btn-ghost" onClick={signOut} type="button">
            {no.admin.signOut}
          </button>
        </div>

        <div className="row wrap-gap">
          <button
            className="btn btn-gold"
            onClick={() => router.push("/ny")}
            type="button"
          >
            {no.admin.create}
          </button>
        </div>

        {error && (
          <p className="faint" style={{ color: "#f0a6a0" }}>
            {error}
          </p>
        )}

        {rows.length === 0 ? (
          <div className="card card-pad stack">
            <p>{no.admin.empty}</p>
            <p className="faint">{no.admin.emptyHint}</p>
          </div>
        ) : (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {rows.map((t) => (
              <li key={t.id} className="card card-pad stack">
                {editing === t.id ? (
                  <EditRow
                    row={t}
                    busy={busyId === t.id}
                    onCancel={() => setEditing(null)}
                    onSaved={async (patch) => {
                      await withBusy(t.id, async () => {
                        await api.editTournament(t.id, patch);
                        setRows((r) =>
                          r.map((x) =>
                            x.id === t.id ? { ...x, ...patch } : x,
                          ),
                        );
                        setEditing(null);
                      });
                    }}
                  />
                ) : (
                  <>
                    <div className="spread wrap-gap">
                      <div className="stack" style={{ gap: 2 }}>
                        <strong style={{ fontSize: "1.1rem" }}>
                          {t.title || "—"}
                        </strong>
                        <span className="faint" style={{ fontSize: ".85rem" }}>
                          {[t.sport_label, STATUS[t.status]]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                    </div>
                    <div className="btn-row">
                      <button
                        className="btn"
                        onClick={() => router.push(`/board/${t.id}`)}
                        type="button"
                      >
                        {no.admin.openBoard}
                      </button>
                      <button
                        className="btn"
                        onClick={() => router.push(`/kontroll/${t.id}`)}
                        type="button"
                      >
                        {no.admin.openControl}
                      </button>
                      <button
                        className="btn"
                        onClick={() => setEditing(t.id)}
                        type="button"
                        disabled={busyId === t.id}
                      >
                        {no.admin.edit}
                      </button>
                      {t.status === "finished" && (
                        <button
                          className="btn"
                          onClick={() => onReopen(t)}
                          type="button"
                          disabled={busyId === t.id}
                        >
                          {busyId === t.id ? no.admin.reopening : no.admin.reopen}
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        onClick={() => onDelete(t)}
                        type="button"
                        disabled={busyId === t.id}
                      >
                        {busyId === t.id ? no.admin.deleting : no.admin.delete}
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function EditRow({
  row,
  busy,
  onCancel,
  onSaved,
}: {
  row: OrganiserTournamentRow;
  busy: boolean;
  onCancel: () => void;
  onSaved: (patch: { title: string; sport_label: string }) => void;
}) {
  const [title, setTitle] = useState(row.title);
  const [sport, setSport] = useState(row.sport_label);

  return (
    <div className="stack">
      <div className="field">
        <label className="label">{no.admin.titleLabel}</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
        />
      </div>
      <div className="field">
        <label className="label">{no.admin.sportLabel}</label>
        <input
          className="input"
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          maxLength={40}
        />
      </div>
      <div className="btn-row">
        <button
          className="btn btn-gold"
          onClick={() => onSaved({ title: title.trim(), sport_label: sport.trim() })}
          type="button"
          disabled={busy}
        >
          {busy ? no.admin.saving : no.admin.save}
        </button>
        <button
          className="btn btn-ghost"
          onClick={onCancel}
          type="button"
          disabled={busy}
        >
          {no.admin.cancel}
        </button>
      </div>
    </div>
  );
}
