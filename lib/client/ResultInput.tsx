"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  MatchResult,
  ScoringConfig,
  SpecialKind,
  Team,
} from "@/lib/types";
import { MAX_SCORE, validateResult } from "@/lib/tournament/scoring";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { NumberField } from "@/lib/client/NumberField";

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
  /** Called with the running score whenever the referee changes it (simple
   * and sets profiles, never in special-result mode). The caller debounces
   * and pushes it to the board as a live score. */
  onLive?: (result: MatchResult) => void;
  /** Knockout (playoff/cup) match: a level score is not a draw — the referee
   * picks who went through (penalties / extra time). */
  knockout?: boolean;
  /** Extra controls placed between the result fields and the Save button
   * (the referee sheet puts its countdown here). */
  aside?: ReactNode;
}

// A few common scorelines offered as one-tap chips (simple profile). Each is
// offered both ways round, so "the second team won" is as quick as the first:
// the first number is always the team listed first.
const QUICK_WINS: [number, number][] = [
  [1, 0],
  [2, 0],
  [2, 1],
  [3, 0],
  [3, 1],
];
const QUICK_DRAWS: [number, number][] = [
  [0, 0],
  [1, 1],
];

export function ResultInput({
  scoring,
  home,
  away,
  initial,
  onSubmit,
  submitting,
  onLive,
  knockout = false,
  aside,
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

  // simple, knockout only: who went through on a level score
  const [decider, setDecider] = useState<"home" | "away" | null>(
    initial && "decider" in initial ? (initial.decider ?? null) : null,
  );
  const level = hs === as;

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

  // Live score: report the running tally as the referee taps. Ref-held callback
  // so an inline arrow from the parent does not retrigger the effect.
  const onLiveRef = useRef(onLive);
  useEffect(() => {
    onLiveRef.current = onLive;
  });
  useEffect(() => {
    if (!onLiveRef.current || showSpecial) return;
    if (profile === "simple") onLiveRef.current({ home: hs, away: as });
    else if (profile === "sets") onLiveRef.current({ sets, home: 0, away: 0 });
  }, [hs, as, sets, profile, showSpecial]);

  function build(): MatchResult | null {
    if (special) {
      if (special === "abandoned") return { special: "abandoned" };
      if (!specialWinner) return null;
      return { special, winner: specialWinner };
    }
    if (profile === "simple")
      return knockout && level && decider ? { home: hs, away: as, decider } : { home: hs, away: as };
    if (profile === "sets") return { sets, home: 0, away: 0 } as MatchResult;
    if (winner) return { winner };
    return null;
  }

  function submit() {
    const r = build();
    if (!r) {
      setErr(special ? no.control.pickTeam : no.control.pickWinner);
      return;
    }
    const v = validateResult(profile, r, scoring, { knockout });
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
        <div className="stack stack-tight">
          <div className="score-card">
            <div className="score-head">
              <span className="label">{no.control.resultLabel}</span>
              <button
                type="button"
                className="score-reset"
                onClick={() => {
                  setHs(0);
                  setAs(0);
                }}
              >
                {no.control.reset}
              </button>
            </div>
            <ScoreRow team={home} value={hs} onChange={setHs} />
            <ScoreRow team={away} value={as} onChange={setAs} />
          </div>
          <div className="quick">
            <span className="label">{no.control.suggestions}</span>
            <div className="quick-grid">
              {QUICK_WINS.map(([h, a]) => (
                <QuickChip key={`${h}-${a}`} h={h} a={a} hs={hs} as={as} onPick={pickScore} />
              ))}
              {QUICK_WINS.map(([h, a]) => (
                <QuickChip key={`${a}-${h}`} h={a} a={h} hs={hs} as={as} onPick={pickScore} />
              ))}
              {scoring.allowDraw &&
                !knockout &&
                QUICK_DRAWS.map(([h, a]) => (
                  <QuickChip key={`${h}-${a}`} h={h} a={a} hs={hs} as={as} onPick={pickScore} />
                ))}
            </div>
          </div>
          {knockout && level && (
            <div className="stack stack-tight" role="group" aria-label={no.control.deciderTitle}>
              <span className="label">{no.control.deciderTitle}</span>
              <span className="hint">{no.control.deciderHint}</span>
              <div className="bigchoice">
                <button data-on={decider === "home"} aria-pressed={decider === "home"} onClick={() => setDecider("home")}>
                  <TeamLabel team={home} />
                </button>
                <button data-on={decider === "away"} aria-pressed={decider === "away"} onClick={() => setDecider("away")}>
                  <TeamLabel team={away} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!special && profile === "sets" && (
        <div className="stack stack-tight">
          <div className="spread">
            <strong className="sets-tally">{no.control.setsTally(setTally[0], setTally[1])}</strong>
            {scoring.setsBestOf ? (
              <span className="hint">{no.control.bestOf(scoring.setsBestOf)}</span>
            ) : null}
          </div>
          <div className="set-row set-head">
            <TeamTag team={home} />
            <span />
            <TeamTag team={away} />
            <span className="set-gap" />
          </div>
          {sets.map((s, i) => (
            <div className="set-row" key={i}>
              <NumberField
                compact
                className="set-input"
                min={0}
                max={MAX_SCORE}
                value={s[0]}
                onChange={(n) => updateSet(sets, setSets, i, 0, n)}
                aria-label={no.control.teamSet(home.name, i + 1)}
              />
              <span className="versus-mid">–</span>
              <NumberField
                compact
                className="set-input"
                min={0}
                max={MAX_SCORE}
                value={s[1]}
                onChange={(n) => updateSet(sets, setSets, i, 1, n)}
                aria-label={no.control.teamSet(away.name, i + 1)}
              />
              {sets.length > 1 ? (
                <button
                  className="btn-icon"
                  aria-label={no.control.removeSet(i + 1)}
                  onClick={() => setSets(sets.filter((_, j) => j !== i))}
                >
                  <Icon name="close" />
                </button>
              ) : (
                <span className="set-gap" />
              )}
            </div>
          ))}
          <button className="btn btn-ghost" onClick={() => setSets([...sets, [0, 0]])}>
            <Icon name="more" size={16} />
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
          <button type="button" className="disclosure-sum special-toggle" onClick={() => setShowSpecial(true)}>
            <span className="disclosure-title">{no.control.special}</span>
            <Icon name="chevronDown" size={16} />
          </button>
        ) : (
          <div className="stack stack-tight">
            <div className="spread">
              <span className="label">{no.control.special}</span>
              <button
                type="button"
                className="special-toggle"
                onClick={() => {
                  setShowSpecial(false);
                  setSpecial(null);
                  setSpecialWinner(null);
                }}
              >
                <Icon name="back" size={16} />
                {no.control.specialBack}
              </button>
            </div>
            <div className="quick-row">
              {(
                [
                  ["walkover", no.control.specialWalkover],
                  ["disqualification", no.control.specialDq],
                  ["abandoned", no.control.specialAbandoned],
                ] as [SpecialKind, string][]
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  className="quick-chip"
                  data-on={special === kind}
                  aria-pressed={special === kind}
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
              <div className="stack stack-tight">
                <span className="hint">{no.control.specialPickWinner}</span>
                <div className="bigchoice">
                  <button
                    data-on={specialWinner === "home"}
                    aria-pressed={specialWinner === "home"}
                    onClick={() => setSpecialWinner("home")}
                  >
                    <TeamLabel team={home} />
                  </button>
                  <button
                    data-on={specialWinner === "away"}
                    aria-pressed={specialWinner === "away"}
                    onClick={() => setSpecialWinner("away")}
                  >
                    <TeamLabel team={away} />
                  </button>
                </div>
              </div>
            )}
            {special === "abandoned" && <span className="hint">{no.control.specialAbandonedHint}</span>}
          </div>
        )}
      </div>

      {aside}

      <div className="result-foot">
        {err && <div className="toast-danger" role="alert">{err}</div>}
        <button
          className="btn btn-gold btn-block btn-lg"
          onClick={submit}
          disabled={submitting || (showSpecial && !special)}
        >
          {submitting ? <span className="spin" /> : null}
          {submitting ? no.control.saving : no.control.save}
        </button>
      </div>
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
      type="button"
      className="quick-chip"
      data-on={hs === h && as === a}
      aria-pressed={hs === h && as === a}
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
  n: number,
) {
  const next = sets.map((s, i) =>
    i === idx ? ((side === 0 ? [n, s[1]] : [s[0], n]) as [number, number]) : s,
  );
  setSets(next);
}

/** One team's score: colour + name on top, then [−] [score] [+] across the
 * full width. The score itself is a number field — tap it and type. */
function ScoreRow({
  team,
  value,
  onChange,
}: {
  team: Team;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="score-row">
      <TeamTag team={team} />
      <NumberField
        className="score-field"
        min={0}
        max={MAX_SCORE}
        value={value}
        onChange={onChange}
        aria-label={team.name}
      />
    </div>
  );
}

/** Team colour + name (data colour stays inline: it is not a design token). */
function TeamTag({ team }: { team: Team }) {
  return (
    <span className="team score-team">
      <span className="team-swatch" style={{ background: team.colour }} />
      <span className="team-name">{team.name}</span>
    </span>
  );
}

function TeamLabel({ team }: { team: Team }) {
  return (
    <span className="team team-centered">
      <span className="team-swatch" style={{ background: team.colour }} />
      <span className="team-name">{team.name}</span>
    </span>
  );
}
