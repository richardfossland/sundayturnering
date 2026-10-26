"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { SiteHeader, backToHome } from "@/lib/client/SiteHeader";
import { paletteColour } from "@/lib/palette";
import { defaultScoringConfig } from "@/lib/tournament/scoring";
import type { ScoringProfileKey } from "@/lib/types";
import { myTournaments } from "@/lib/client/myTournaments";
import { errorMessage } from "@/lib/locale/errors";

// Enkeltkamp (quick 1v1): a single knockout match (a 2-team "cup" = one final), created
// instantly with no wizard. Reuses the standard create path + the post-create
// organiser page (/arrangor/[id]).
export default function HurtigPage() {
  const router = useRouter();
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [profile, setProfile] = useState<ScoringProfileKey>("simple");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    const h = home.trim() || no.hurtig.home;
    const a = away.trim() || no.hurtig.away;
    const title = `${h} ${no.common.vs} ${a}`;
    setBusy(true);
    setErr(null);
    try {
      const result = await api.create({
        title,
        sport_label: "",
        format: "cup",
        scoring: defaultScoringConfig(profile),
        parallelism: "sequential",
        config: { playoffSize: 0, roundRobinDouble: false },
        teams: [
          { name: h, colour: paletteColour(0), logo_url: null, members: [] },
          { name: a, colour: paletteColour(3), logo_url: null, members: [] },
        ],
        courts: [],
      });
      myTournaments.remember({ ...result, title });
      router.replace(`/arrangor/${result.id}`);
    } catch (e) {
      setBusy(false);
      setErr(errorMessage(e));
    }
  }

  return (
    <>
      <SiteHeader back={backToHome} />
      <main className="center-screen">
        <div className="card card-pad stack hurtig-card">
          <div className="stack stack-tight">
            <h1 className="hurtig-title">
              <Icon name="quick" size={22} className="icon-title" />
              {no.hurtig.title}
            </h1>
            <p className="hint">{no.hurtig.blurb}</p>
          </div>

          <div className="stack">
            <div className="field">
              <label className="label" htmlFor="hurtig-home">{no.hurtig.home}</label>
              <input
                id="hurtig-home"
                className="input"
                value={home}
                onChange={(e) => setHome(e.target.value)}
                placeholder={no.hurtig.homePlaceholder}
                maxLength={40}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="hurtig-away">{no.hurtig.away}</label>
              <input
                id="hurtig-away"
                className="input"
                value={away}
                onChange={(e) => setAway(e.target.value)}
                placeholder={no.hurtig.awayPlaceholder}
                maxLength={40}
              />
            </div>
            <p className="hint">{no.hurtig.namesHint}</p>
          </div>

          <div className="field">
            <span className="label" id="hurtig-scoring">{no.hurtig.scoringTitle}</span>
            <div className="seg" role="radiogroup" aria-labelledby="hurtig-scoring">
              {(
                [
                  ["simple", no.hurtig.score, no.hurtig.scoreHint],
                  ["winner", no.hurtig.winner, no.hurtig.winnerHint],
                ] as const
              ).map(([key, title, hint]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={profile === key}
                  className="seg-btn seg-choice"
                  onClick={() => setProfile(key)}
                >
                  <span className="seg-title">{title}</span>
                  <span className="seg-hint">{hint}</span>
                </button>
              ))}
            </div>
          </div>

          {err && (
            <div className="toast-danger" role="alert">
              {err}
            </div>
          )}
          <button className="btn btn-gold btn-lg btn-block" onClick={start} disabled={busy}>
            {busy ? <span className="spin" /> : null}
            {busy ? no.hurtig.starting : no.hurtig.start}
          </button>
        </div>
      </main>
    </>
  );
}
