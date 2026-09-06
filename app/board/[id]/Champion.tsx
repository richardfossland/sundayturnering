"use client";

import { useEffect } from "react";
import { no } from "@/lib/locale/no";
import { championId, initials } from "@/lib/client/view";
import { playFanfare } from "@/lib/client/sound";
import { Confetti } from "./Confetti";
import type { Team } from "@/lib/types";
import type { StateDTO } from "@/lib/dto";

// Winner / podium celebration. Champion = winner of the playoff FINAL (bracket
// slot 0 — the bronze final shares the last round and must never crown), else
// the rank-1 league standing. One rule, shared with the results page via
// championId() so the board and the diploma can never disagree.
export function Champion({ state }: { state: StateDTO }) {
  const { teams } = state;
  const byId = new Map(teams.map((t) => [t.id, t]));
  const winnerId = championId(state);
  const champ: Team | undefined = winnerId ? byId.get(winnerId) : undefined;

  useEffect(() => {
    playFanfare();
  }, []);

  return (
    <main className="champion">
      <Confetti />
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
        <a
          className="btn"
          href={`/resultat/${state.tournament.id}`}
          target="_blank"
          rel="noopener"
          style={{ marginTop: 24 }}
        >
          🏅 Resultater &amp; diplom
        </a>
      </div>
    </main>
  );
}
