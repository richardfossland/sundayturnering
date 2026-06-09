"use client";

import { no } from "@/lib/locale/no";
import { initials } from "@/lib/client/view";
import type { Team } from "@/lib/types";
import type { StateDTO } from "@/lib/dto";

// Winner / podium celebration. Champion = winner of the playoff final, else the
// rank-1 league standing.
export function Champion({ state }: { state: StateDTO }) {
  const { matches, standings, teams } = state;
  const byId = new Map(teams.map((t) => [t.id, t]));

  let championId: string | null = null;
  const playoff = matches.filter((m) => m.phase === "playoff");
  if (playoff.length > 0) {
    const totalRounds = Math.max(...playoff.map((m) => m.round));
    const final = playoff.find(
      (m) => m.round === totalRounds && m.status === "done",
    );
    championId = final?.winner_team_id ?? null;
  }
  if (!championId && standings.length > 0) championId = standings[0].team_id;

  const champ: Team | undefined = championId ? byId.get(championId) : undefined;

  return (
    <main className="champion">
      <div className="champion-inner">
        <div className="champion-eyebrow">🏆 {no.board.champion}</div>
        {champ?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="champion-logo" src={champ.logo_url} alt="" />
        ) : (
          <div
            className="champion-badge"
            style={{ background: champ?.colour ?? "var(--gold)" }}
          >
            {champ ? initials(champ.name) : "🏆"}
          </div>
        )}
        <h1 className="champion-name">{champ?.name ?? "—"}</h1>
      </div>
    </main>
  );
}
