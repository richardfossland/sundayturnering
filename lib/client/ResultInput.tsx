"use client";

import { useState } from "react";
import type { MatchResult, ScoringConfig, Team } from "@/lib/types";
import { validateResult } from "@/lib/tournament/scoring";
import { no } from "@/lib/locale/no";

// Profile-driven result entry (spec §3). Renders steppers (simple), an add-set
// grid (sets), or two big buttons (winner), and reports a valid MatchResult.

interface Props {
  scoring: ScoringConfig;
  home: Team;
  away: Team;
  initial?: MatchResult | null;
  onSubmit: (result: MatchResult) => void;
  submitting?: boolean;
}

export function ResultInput({
  scoring,
  home,
  away,
  initial,
  onSubmit,
  submitting,
}: Props) {
  const profile = scoring.profile;

  // simple
  const [hs, setHs] = useState<number>(
    initial && "home" in initial && !("sets" in initial) ? initial.home : 0,
  );
  const [as, setAs] = useState<number>(
    initial && "away" in initial && !("sets" in initial) ? initial.away : 0,
  );

  // sets
  const [sets, setSets] = useState<[number, number][]>(
    initial && "sets" in initial && initial.sets.length
      ? initial.sets
      : [[0, 0]],
  );

  // winner
  const [winner, setWinner] = useState<"home" | "away" | null>(
    initial && "winner" in initial ? initial.winner : null,
  );

  const [err, setErr] = useState<string | null>(null);

  function build(): MatchResult | null {
    if (profile === "simple") return { home: hs, away: as };
    if (profile === "sets")
      return { sets, home: 0, away: 0 } as MatchResult; // counts recomputed server-side
    if (winner) return { winner };
    return null;
  }

  function submit() {
    const r = build();
    if (!r) {
      setErr("Velg hvem som vant."); // winner profile, none chosen
      return;
    }
    const v = validateResult(profile, r, scoring);
    if (v) {
      setErr(v);
      return;
    }
    setErr(null);
    onSubmit(r);
  }

  return (
    <div className="stack">
      {profile === "simple" && (
        <div className="spread" style={{ alignItems: "stretch", gap: 16 }}>
          <Stepper label={home.name} colour={home.colour} value={hs} onChange={setHs} />
          <span className="versus-mid" style={{ alignSelf: "center" }}>
            {no.common.vs}
          </span>
          <Stepper label={away.name} colour={away.colour} value={as} onChange={setAs} />
        </div>
      )}

      {profile === "sets" && (
        <div className="stack">
          {sets.map((s, i) => (
            <div className="set-row" key={i}>
              <input
                className="input set-input"
                type="number"
                min={0}
                inputMode="numeric"
                value={s[0]}
                onChange={(e) =>
                  updateSet(sets, setSets, i, 0, e.target.value)
                }
                aria-label={`${home.name} sett ${i + 1}`}
              />
              <span className="versus-mid">–</span>
              <input
                className="input set-input"
                type="number"
                min={0}
                inputMode="numeric"
                value={s[1]}
                onChange={(e) =>
                  updateSet(sets, setSets, i, 1, e.target.value)
                }
                aria-label={`${away.name} sett ${i + 1}`}
              />
              {sets.length > 1 ? (
                <button
                  className="btn btn-ghost"
                  onClick={() => setSets(sets.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              ) : (
                <span style={{ width: 44 }} />
              )}
            </div>
          ))}
          <button
            className="btn btn-ghost"
            onClick={() => setSets([...sets, [0, 0]])}
          >
            {no.control.addSet}
          </button>
        </div>
      )}

      {profile === "winner" && (
        <div className="bigchoice">
          <button data-on={winner === "home"} onClick={() => setWinner("home")}>
            <TeamLabel team={home} />
          </button>
          <button data-on={winner === "away"} onClick={() => setWinner("away")}>
            <TeamLabel team={away} />
          </button>
        </div>
      )}

      {err && <div className="toast-danger" style={{ fontSize: ".9rem" }}>{err}</div>}

      <button
        className="btn btn-gold btn-block btn-lg"
        onClick={submit}
        disabled={submitting}
      >
        {submitting ? <span className="spin" /> : null}
        {submitting ? no.control.saving : no.control.save}
      </button>
    </div>
  );
}

function updateSet(
  sets: [number, number][],
  setSets: (s: [number, number][]) => void,
  idx: number,
  side: 0 | 1,
  raw: string,
) {
  const n = Math.max(0, Math.floor(Number(raw) || 0));
  const next = sets.map((s, i) =>
    i === idx ? ((side === 0 ? [n, s[1]] : [s[0], n]) as [number, number]) : s,
  );
  setSets(next);
}

function Stepper({
  label,
  colour,
  value,
  onChange,
}: {
  label: string;
  colour: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="stack" style={{ alignItems: "center", gap: 10, flex: 1 }}>
      <div className="team" style={{ maxWidth: "100%" }}>
        <span className="team-swatch" style={{ background: colour }} />
        <span className="team-name" style={{ fontWeight: 700 }}>
          {label}
        </span>
      </div>
      <div className="stepper">
        <button onClick={() => onChange(Math.max(0, value - 1))} aria-label="minus">
          −
        </button>
        <span className="stepper-val">{value}</span>
        <button onClick={() => onChange(value + 1)} aria-label="pluss">
          +
        </button>
      </div>
    </div>
  );
}

function TeamLabel({ team }: { team: Team }) {
  return (
    <span className="team" style={{ justifyContent: "center" }}>
      <span className="team-swatch" style={{ background: team.colour }} />
      <span className="team-name">{team.name}</span>
    </span>
  );
}
