"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import { initials, finalRanking, championId } from "@/lib/client/view";
import type { StateDTO } from "@/lib/dto";
import type { Team } from "@/lib/types";

// Printable results + diplomas. "Skriv ut / lagre PDF" uses the browser's
// print-to-PDF (print CSS forces a clean white sheet).
export function ResultClient({ id }: { id: string }) {
  const [state, setState] = useState<StateDTO | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.fetchState(id).then(setState, () => setError(true));
  }, [id]);

  if (error) return <main className="center-screen"><div className="empty">{no.common.error}</div></main>;
  if (!state) return <main className="center-screen"><span className="spin" /></main>;

  const ranked = finalRanking(state);
  const champ = championId(state);
  const champTeam = ranked.find((t) => t.id === champ) ?? ranked[0];

  return (
    <main className="result-page">
      <div className="result-actions">
        <button className="btn btn-gold" onClick={() => window.print()}>
          🖨️ Skriv ut / lagre som PDF
        </button>
      </div>

      <div className="result-sheet">
        <header className="result-head">
          <span className="brand">
            <span className="brand-mark">T</span>
            {no.brand}
          </span>
          <h1>{state.tournament.title || "Turnering"}</h1>
          {state.tournament.sport_label && (
            <div className="result-sport">{state.tournament.sport_label}</div>
          )}
        </header>

        {champTeam && (
          <section className="result-champ">
            <div className="result-champ-eyebrow">🏆 Vinner</div>
            <TeamCrest team={champTeam} size={86} />
            <div className="result-champ-name">{champTeam.name}</div>
          </section>
        )}

        <section className="result-podium">
          {ranked.map((t, i) => (
            <div className="diploma" key={t.id}>
              <div className="diploma-place">{medal(i + 1)}</div>
              <TeamCrest team={t} size={54} />
              <div className="diploma-name">{t.name}</div>
              {t.members.length > 0 && (
                <div className="diploma-members">{t.members.join(" · ")}</div>
              )}
            </div>
          ))}
        </section>

        <footer className="result-foot">
          turnering.sundaysuite.app
        </footer>
      </div>
    </main>
  );
}

function medal(place: number): string {
  if (place === 1) return "🥇 1.";
  if (place === 2) return "🥈 2.";
  if (place === 3) return "🥉 3.";
  return `${place}.`;
}

function TeamCrest({ team, size }: { team: Team; size: number }) {
  if (team.logo_url)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={team.logo_url} alt="" width={size} height={size} style={{ borderRadius: size * 0.22, objectFit: "cover" }} />;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: team.colour,
        display: "grid",
        placeItems: "center",
        color: "#fff",
        fontFamily: "var(--display)",
        fontWeight: 900,
        fontSize: size * 0.4,
      }}
    >
      {initials(team.name)}
    </div>
  );
}
