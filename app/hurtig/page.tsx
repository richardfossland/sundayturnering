"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import { paletteColour } from "@/lib/palette";
import { defaultScoringConfig } from "@/lib/tournament/scoring";
import type { ScoringProfileKey } from "@/lib/types";
import { Created } from "../ny/Created";

// Quick 1v1: a single knockout match (a 2-team "cup" = one final), created
// instantly with no wizard. Reuses the standard create path + the post-create
// codes screen (Created).
export default function HurtigPage() {
  const router = useRouter();
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [profile, setProfile] = useState<ScoringProfileKey>("simple");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{
    id: string;
    control_code: string;
    board_code: string;
    organiser_code: string;
  } | null>(null);

  async function start() {
    const h = home.trim() || no.hurtig.home;
    const a = away.trim() || no.hurtig.away;
    setBusy(true);
    try {
      const result = await api.create({
        title: `${h} ${no.common.vs} ${a}`,
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
      setCreated(result);
    } catch {
      setBusy(false);
      alert(no.common.error);
    }
  }

  if (created)
    return <Created result={created} onBoard={() => router.push(`/board/${created.id}`)} />;

  return (
    <main className="center-screen">
      <div className="card card-pad stack" style={{ maxWidth: 440, width: "100%" }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: "1.5rem" }}>⚡ {no.hurtig.title}</h1>
          <p className="faint" style={{ fontSize: ".9rem" }}>{no.hurtig.blurb}</p>
        </div>

        <div className="field">
          <input
            className="input"
            value={home}
            onChange={(e) => setHome(e.target.value)}
            placeholder={no.hurtig.home}
            maxLength={40}
          />
        </div>
        <div className="center faint" style={{ fontWeight: 700 }}>{no.common.vs}</div>
        <div className="field">
          <input
            className="input"
            value={away}
            onChange={(e) => setAway(e.target.value)}
            placeholder={no.hurtig.away}
            maxLength={40}
          />
        </div>

        <div className="chips">
          <button className="chip" data-on={profile === "simple"} onClick={() => setProfile("simple")}>
            {no.hurtig.score}
          </button>
          <button className="chip" data-on={profile === "winner"} onClick={() => setProfile("winner")}>
            {no.hurtig.winner}
          </button>
        </div>

        <button className="btn btn-gold btn-lg btn-block" onClick={start} disabled={busy}>
          {busy ? <span className="spin" /> : null}
          {busy ? no.hurtig.starting : no.hurtig.start}
        </button>
      </div>
    </main>
  );
}
