"use client";

import { useEffect, useMemo, useState } from "react";
import { useTournament } from "@/lib/client/useTournament";
import { usePresence } from "@/lib/client/usePresence";
import { identity } from "@/lib/client/identity";
import { teamMap } from "@/lib/client/view";
import { resolve } from "@/lib/tournament/scoring";
import { no } from "@/lib/locale/no";
import type { Match } from "@/lib/types";
import { ResultModal } from "./ResultModal";
import { OrganiserPanel } from "./OrganiserPanel";

type Tab = "scheduled" | "live" | "done";

export function ControlClient({ id }: { id: string }) {
  const { state, error, refetch } = useTournament(id);
  const [tab, setTab] = useState<Tab>("scheduled");
  const [courtId, setCourtId] = useState<string | null>(null); // filter
  const [open, setOpen] = useState<Match | null>(null);
  const [self, setSelf] = useState<{ deviceId: string; name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // Read browser-only identity/prefs after mount (hydration-safe).
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelf({ deviceId: identity.deviceId(), name: identity.deviceName() || "Enhet" });
    setCourtId(identity.pinnedCourt(id));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [id]);

  const devices = usePresence(id, self);
  const teams = useMemo(() => teamMap(state?.teams ?? []), [state?.teams]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  if (error && !state)
    return (
      <main className="center-screen">
        <div className="stack center">
          <div className="empty">{no.common.error}</div>
          <button className="btn" onClick={refetch}>{no.common.retry}</button>
        </div>
      </main>
    );
  if (!state)
    return <main className="center-screen"><span className="spin" /></main>;

  const { tournament, matches, courts } = state;
  const parallel = tournament.parallelism === "parallel";

  const filtered = matches
    .filter((m) => {
      if (m.status === "bye") return false;
      if (tab === "live") return m.status === "live";
      if (tab === "done") return m.status === "done";
      return m.status === "scheduled";
    })
    .filter((m) => !courtId || m.court_id === courtId)
    .sort((a, b) => a.queue_order - b.queue_order);

  function pin(cId: string | null) {
    setCourtId(cId);
    identity.setPinnedCourt(id, cId);
  }

  return (
    <main className="control">
      <div className="control-head stack" style={{ gap: 10 }}>
        <div className="spread">
          <span className="brand" style={{ fontSize: ".95rem" }}>
            <span className="brand-mark" style={{ width: 26, height: 26, fontSize: ".8rem" }}>T</span>
            {tournament.title || no.brand}
          </span>
          <span className="pill">
            {devices.length} {no.pair.attached}
          </span>
        </div>

        <div className="tabs">
          {(["scheduled", "live", "done"] as Tab[]).map((t) => (
            <button key={t} className="tab" data-on={tab === t} onClick={() => setTab(t)}>
              {t === "scheduled" ? no.control.scheduled : t === "live" ? no.control.live : no.control.done}
            </button>
          ))}
        </div>

        {parallel && courts.length > 0 && (
          <div className="chips">
            <button className="chip" data-on={!courtId} onClick={() => pin(null)}>
              {no.control.allCourts}
            </button>
            {courts.map((c) => (
              <button key={c.id} className="chip" data-on={courtId === c.id} onClick={() => pin(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        {filtered.length === 0 ? (
          <div className="empty">{no.board.noMatches}</div>
        ) : (
          filtered.map((m) => (
            <MatchCard
              key={m.id}
              m={m}
              teams={teams}
              courts={courts}
              profile={tournament.scoring.profile}
              onTap={() => setOpen(m)}
            />
          ))
        )}
      </div>

      <div style={{ marginTop: 22 }}>
        <OrganiserPanel
          tournament={tournament}
          matches={matches}
          teams={teams}
          onChanged={refetch}
          flash={flash}
        />
      </div>

      {open && (
        <ResultModal
          match={
            // always render the freshest copy of the match
            matches.find((x) => x.id === open.id) ?? open
          }
          tournament={tournament}
          teams={teams}
          deviceId={self?.deviceId ?? "anon"}
          deviceName={self?.name ?? "Enhet"}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            refetch();
          }}
          onConflict={() => {
            flash(no.control.conflict);
            refetch();
          }}
        />
      )}

      {toast && <div className="toast toast-danger">{toast}</div>}
    </main>
  );
}

function MatchCard({
  m,
  teams,
  courts,
  profile,
  onTap,
}: {
  m: Match;
  teams: Map<string, import("@/lib/types").Team>;
  courts: import("@/lib/types").Court[];
  profile: import("@/lib/types").ScoringProfileKey;
  onTap: () => void;
}) {
  const h = m.home_team_id ? teams.get(m.home_team_id) : null;
  const a = m.away_team_id ? teams.get(m.away_team_id) : null;
  const court = courts.find((c) => c.id === m.court_id);
  const locked = m.locked_by && m.status !== "done";
  const lockName = locked ? m.locked_by!.split("|")[1] : null;
  const r = m.result ? resolve(profile, m.result) : null;
  const ready = h && a;

  return (
    <button
      className="match-card"
      data-locked={!!locked}
      onClick={onTap}
      disabled={!ready && m.status !== "done"}
    >
      <div className="match-teams">
        <TeamLine team={h} />
        <TeamLine team={a} />
      </div>
      <div className="match-meta stack" style={{ gap: 4, alignItems: "flex-end" }}>
        {m.status === "done" && r ? (
          <span className="match-result">{r.display.split(" ")[0]}</span>
        ) : m.status === "live" ? (
          <span className="pill pill-live"><span className="dot" />{no.control.live}</span>
        ) : null}
        {court && <span>{court.name}</span>}
        {lockName && <span style={{ color: "var(--warn)" }}>{no.control.lockedBy(lockName)}</span>}
      </div>
    </button>
  );
}

function TeamLine({ team }: { team: import("@/lib/types").Team | null | undefined }) {
  return (
    <span className="team">
      <span className="team-swatch" style={{ background: team?.colour ?? "#555" }} />
      <span className="team-name">{team?.name ?? no.board.tbd}</span>
    </span>
  );
}
