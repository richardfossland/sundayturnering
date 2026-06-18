"use client";

import { useState } from "react";
import type {
  MatchResult,
  ScoringConfig,
  SpecialKind,
  Team,
} from "@/lib/types";
import { validateResult } from "@/lib/tournament/scoring";
import { no } from "@/lib/locale/no";

// Profile-driven result entry (spec §3) + quick-score helpers + a special-result
// affordance (walkover / abandoned / DQ). Renders a live scoreboard with
// steppers (simple), a running set grid (sets), or two big buttons (winner),
// and reports a valid MatchResult.

interface Props {
  scoring: ScoringConfig;
  home: Team;
  away: Team;
  initial?: MatchResult | null;
  onSubmit: (result: MatchResult) => void;
  submitting?: boolean;
}

// A few common scorelines offered as one-tap chips (simple profile).
const QUICK_SCORES: [number, number][] = [
  [1, 0],
  [2, 0],
  [2, 1],
  [3, 0],
  [3, 1],
];

export function ResultInput({
  scoring,
  home,
  away,
  initial,
  onSubmit,
  submitting,
}: Props) {
  const profile = scoring.profile;
  const initSpecial =
    initial && "special" in initial ? initial : null;

  // simple
  const [hs, setHs] = useState<number>(
    initial && "home" in initial && !("sets" in initial) ? initial.home : 0,
  );
  const [as, setAs] = useState<number>(
    initial && "away" in initial && !("sets" in initial) ? initial.away : 0,
  );

  // sets
  const [sets, setSets] = useState<[number, number][]>(
    initial && "sets" in initial && initial.sets.length ? initial.sets : [[0, 0]],
  );

  // winner
  const [winner, setWinner] = useState<"home" | "away" | null>(
    initial && "winner" in initial && !("special" in initial)
      ? initial.winner
      : null,
  );

  // special-result mode
  const [showSpecial, setShowSpecial] = useState<boolean>(!!initSpecial);
  const [special, setSpecial] = useState<SpecialKind | null>(
    initSpecial?.special ?? null,
  );
  const [specialWinner, setSpecialWinner] = useState<"home" | "away" | null>(
    initSpecial && "winner" in initSpecial ? (initSpecial.winner ?? null) : null,
  );

  const [err, setErr] = useState<string | null>(null);

  function build(): MatchResult | null {
    if (special) {
      if (special === "abandoned") return { special: "abandoned" };
      if (!specialWinner) return null;
      return { special, winner: specialWinner };
    }
    if (profile === "simple") return { home: hs, away: as };
    if (profile === "sets") return { sets, home: 0, away: 0 } as MatchResult;
    if (winner) return { winner };
    return null;
  }

  function submit() {
    const r = build();
    if (!r) {
      setErr(special ? no.control.pickTeam : "Velg hvem som vant.");
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

  // sets running tally (informational)
  const setTally = sets.reduce<[number, number]>(
    (acc, [h, a]) => (h > a ? [acc[0] + 1, acc[1]] : a > h ? [acc[0], acc[1] + 1] : acc),
    [0, 0],
  );

  return (
    <div className="stack">
      {!special && profile === "simple" && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="scoreboard">
            <ScoreColumn team={home} value={hs} onChange={setHs} />
            <span className="sb-sep">{no.common.vs}</span>
            <ScoreColumn team={away} value={as} onChange={setAs} />
          </div>
          <div className="quick-row">
            <button
              className="quick-chip"
              onClick={() => {
                setHs(0);
                setAs(0);
              }}
            >
              {no.control.reset}
            </button>
            {scoring.allowDraw && (
              <QuickChip h={0} a={0} hs={hs} as={as} onPick={pickScore} />
            )}
            {QUICK_SCORES.map(([h, a]) => (
              <QuickChip key={`${h}-${a}`} h={h} a={a} hs={hs} as={as} onPick={pickScore} />
            ))}
          </div>
        </div>
      )}

      {!special && profile === "sets" && (
        <div className="stack">
          <div className="spread" style={{ alignItems: "center" }}>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>
              {no.control.setsTally(setTally[0], setTally[1])}
            </strong>
            {scoring.setsBestOf ? (
              <span className="faint" style={{ fontSize: ".85rem" }}>
                {no.control.bestOf(scoring.setsBestOf)}
              </span>
            ) : null}
          </div>
          {sets.map((s, i) => (
            <div className="set-row" key={i}>
              <input
                className="input set-input"
                type="number"
                min={0}
                inputMode="numeric"
                value={s[0]}
                onChange={(e) => updateSet(sets, setSets, i, 0, e.target.value)}
                aria-label={`${home.name} sett ${i + 1}`}
              />
              <span className="versus-mid">–</span>
              <input
                className="input set-input"
                type="number"
                min={0}
                inputMode="numeric"
                value={s[1]}
                onChange={(e) => updateSet(sets, setSets, i, 1, e.target.value)}
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
          <button className="btn btn-ghost" onClick={() => setSets([...sets, [0, 0]])}>
            {no.control.addSet}
          </button>
        </div>
      )}

      {!special && profile === "winner" && (
        <div className="bigchoice">
          <button data-on={winner === "home"} onClick={() => setWinner("home")}>
            <TeamLabel team={home} />
          </button>
          <button data-on={winner === "away"} onClick={() => setWinner("away")}>
            <TeamLabel team={away} />
          </button>
        </div>
      )}

      {/* Special-result affordance (all profiles). */}
      <div className="special-box">
        {!showSpecial ? (
          <button className="special-toggle" onClick={() => setShowSpecial(true)}>
            {no.control.special} ▾
          </button>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <div className="spread">
              <span className="label" style={{ margin: 0 }}>
                {no.control.special}
              </span>
              <button
                className="special-toggle"
                onClick={() => {
                  setShowSpecial(false);
                  setSpecial(null);
                  setSpecialWinner(null);
                }}
              >
                {no.control.specialBack}
              </button>
            </div>
            <div className="quick-row" style={{ justifyContent: "flex-start" }}>
              {(
                [
                  ["walkover", no.control.specialWalkover],
                  ["disqualification", no.control.specialDq],
                  ["abandoned", no.control.specialAbandoned],
                ] as [SpecialKind, string][]
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  className="quick-chip"
                  data-on={special === kind}
                  onClick={() => {
                    setSpecial(kind);
                    if (kind === "abandoned") setSpecialWinner(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {special && special !== "abandoned" && (
              <div className="stack" style={{ gap: 8 }}>
                <span className="faint" style={{ fontSize: ".85rem" }}>
                  {no.control.specialPickWinner}
                </span>
                <div className="bigchoice">
                  <button
                    data-on={specialWinner === "home"}
                    onClick={() => setSpecialWinner("home")}
                  >
                    <TeamLabel team={home} />
                  </button>
                  <button
                    data-on={specialWinner === "away"}
                    onClick={() => setSpecialWinner("away")}
                  >
                    <TeamLabel team={away} />
                  </button>
                </div>
              </div>
            )}
            {special === "abandoned" && (
              <span className="faint" style={{ fontSize: ".85rem" }}>
                {no.control.specialAbandonedHint}
              </span>
            )}
          </div>
        )}
      </div>

      {err && <div className="toast-danger" style={{ fontSize: ".9rem" }}>{err}</div>}

      <button
        className="btn btn-gold btn-block btn-lg"
        onClick={submit}
        disabled={submitting || (showSpecial && !special)}
      >
        {submitting ? <span className="spin" /> : null}
        {submitting ? no.control.saving : no.control.save}
      </button>
    </div>
  );

  function pickScore(h: number, a: number) {
    setHs(h);
    setAs(a);
  }
}

function QuickChip({
  h,
  a,
  hs,
  as,
  onPick,
}: {
  h: number;
  a: number;
  hs: number;
  as: number;
  onPick: (h: number, a: number) => void;
}) {
  return (
    <button
      className="quick-chip"
      data-on={hs === h && as === a}
      onClick={() => onPick(h, a)}
    >
      {h}–{a}
    </button>
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

function ScoreColumn({
  team,
  value,
  onChange,
}: {
  team: Team;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="sb-team">
      <span className="team">
        <span className="team-swatch" style={{ background: team.colour }} />
        <span className="team-name">{team.name}</span>
      </span>
      <div className="sb-stepper">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`${team.name} minus`}
        >
          −
        </button>
        <span className="sb-score">{value}</span>
        <button onClick={() => onChange(value + 1)} aria-label={`${team.name} pluss`}>
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
