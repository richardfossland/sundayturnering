"use client";

// Brakettvisning: ett CSS-grid med en kolonne per runde og SVG-linjer mellom
// kolonnene (idé fra brackets-viewer.js, MIT). Utheving av et lags vei ved
// hover/fokus/trykk er inspirert av bracketry (MIT). Se lib/tournament/bracketLayout.ts.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { no } from "@/lib/locale/no";
import { matchTime } from "@/lib/client/view";
import { resolve } from "@/lib/tournament/scoring";
import {
  bracketInputs,
  focusLayout,
  layoutBrackets,
  type BracketInput,
  type LayoutLink,
  type BracketLayout,
  type LayoutNode,
  type SlotOrigin,
} from "@/lib/tournament/bracketLayout";
import type { BracketId, Consolation, Match, ScoringConfig, Team } from "@/lib/types";

/** Navn på brakettene på storskjermen: «A-sluttspill» og «B-sluttspill» (cup: «Trøsterunde»). */
export function bracketLabels(consolation?: Consolation): Record<string, string> {
  return {
    A: no.board.bracketA,
    B: consolation === "first_round_losers" ? no.board.bracketBCup : no.board.bracketB,
    W: no.board.bracketW,
    L: no.board.bracketL,
    GF: no.board.bracketGF,
  };
}

export function Bracket({
  matches,
  teams,
  scoring,
  brackets,
  links,
  consolation,
  only,
  scrollRef,
  fit,
}: {
  matches: Match[];
  teams: Map<string, Team>;
  scoring: ScoringConfig;
  /** Flere braketter (B-sluttspill, taperbrakett …). Uten: én brakett «A» av alle sluttspillkamper. */
  brackets?: BracketInput[];
  /** Ekte brakettkoblinger fra tilstanden; uten dem utledes de fra runde/slot. */
  links?: LayoutLink[];
  /** Bare for navngivning av B-braketten. */
  consolation?: Consolation;
  /** Vis kun denne braketten (storskjermen bytter mellom A og B når begge ikke får plass). */
  only?: BracketId;
  /** Gir forelderen (storskjermens auto-panorering) tilgang til den horisontale scrolleren. */
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** Storskjerm: brakettens størrelse skaleres (CSS) til boksen den står i i stedet for å scrolle. */
  fit?: boolean;
}) {
  // En utgått omkamp (W-laget vant storfinalen) vises ikke.
  const playoff = useMemo(
    () =>
      matches.filter(
        (m) => m.phase === "playoff" && !(m.bracket === "GF" && m.round === 2 && m.status === "bye"),
      ),
    [matches],
  );
  const byId = useMemo(() => new Map(playoff.map((m) => [m.id, m])), [playoff]);
  const layouts = useMemo(() => {
    const all = layoutBrackets(
      brackets ?? bracketInputs(playoff, links, bracketLabels(consolation)),
    );
    const shown = only ? all.filter((l) => l.id === only) : all;
    // Storskjerm: en stor brakett viser bare runder som ikke er helt avgjort.
    if (!fit) return shown;
    const open = (id: string) => {
      const m = byId.get(id);
      return !!m && m.status !== "done" && m.status !== "bye";
    };
    return shown.map((l) => focusLayout(l, open));
  }, [brackets, playoff, links, consolation, only, fit, byId]);

  const ownRef = useRef<HTMLDivElement>(null);
  const scroller = scrollRef ?? ownRef;
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const focus = hover ?? pinned;

  // Bring inneværende runde til syne ved å sette scrollLeft på brakett-scrolleren
  // (aldri scrollIntoView — den scroller ALLE forfedre, også selve siden).
  const currentRound = useMemo(() => {
    const open = playoff
      .filter((m) => !only || (m.bracket ?? "A") === only)
      .filter((m) => m.status !== "done" && m.status !== "bye");
    const live = open.find((m) => m.status === "live" || m.status === "called");
    return (live ?? open.sort((a, b) => a.round - b.round)[0])?.round ?? null;
  }, [playoff, only]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || currentRound == null) return;
    const col = el.querySelector<HTMLElement>(`[data-round="${currentRound}"]`);
    if (!col || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = Math.max(0, col.offsetLeft - el.offsetLeft - 12);
  }, [currentRound, scroller]);

  if (playoff.length === 0)
    return <div className="empty">{no.board.noMatches}</div>;

  // Mål i «kamprad-enheter» som CSS bruker til å regne ut størrelsen: høyde =
  // alle brakettene + bronsefinalen, bredde = flest runder i en brakett.
  const fitRows = layouts.reduce(
    (s, l) => s + l.height + (l.extras.length ? 1.5 : 0) + (layouts.length > 1 ? 0.8 : 0),
    0,
  );
  const fitCols = Math.max(1, ...layouts.map((l) => l.rounds.length));

  return (
    <div
      ref={scroller}
      className={`brk${fit ? " brk-fit" : ""}${focus ? " has-focus" : ""}`}
      style={
        fit
          ? ({ "--brk-rows": fitRows, "--brk-cols": fitCols } as React.CSSProperties)
          : undefined
      }
      onPointerLeave={() => setHover(null)}
    >
      {layouts.map((layout) => (
        <BracketSection
          key={layout.id}
          layout={layout}
          showLabel={layouts.length > 1 && !!layout.label}
          byId={byId}
          teams={teams}
          scoring={scoring}
          focus={focus}
          pinned={pinned}
          onHover={setHover}
          onPin={(id) => setPinned((p) => (p === id ? null : id))}
        />
      ))}
    </div>
  );
}

interface Shared {
  byId: Map<string, Match>;
  teams: Map<string, Team>;
  scoring: ScoringConfig;
  focus: string | null;
  pinned: string | null;
  onHover: (teamId: string | null) => void;
  onPin: (teamId: string) => void;
}

function BracketSection({
  layout,
  showLabel,
  ...s
}: { layout: BracketLayout; showLabel: boolean } & Shared) {
  const cols = layout.rounds.length;
  // Matchkolonne + smal linjekolonne, vekselvis.
  const template = Array.from({ length: cols }, () => "var(--brk-col) var(--brk-gap)")
    .join(" ")
    .replace(/ var\(--brk-gap\)$/, "");

  // Kamper på det uthevede lagets vei (laget er hjemme/borte i dem).
  const onPath = useMemo(() => {
    const set = new Set<string>();
    if (!s.focus) return set;
    for (const n of [...layout.rounds.flatMap((r) => r.nodes), ...layout.extras]) {
      const m = s.byId.get(n.id);
      if (m && (m.home_team_id === s.focus || m.away_team_id === s.focus))
        set.add(n.id);
    }
    return set;
  }, [layout, s.byId, s.focus]);

  return (
    <section className="brk-section">
      {showLabel && <h3 className="brk-title">{layout.label}</h3>}
      <div
        className="brk-grid"
        style={{
          gridTemplateColumns: template,
          // @ts-expect-error CSS custom property
          "--brk-h": layout.height,
        }}
      >
        {layout.rounds.map((r) => (
          <div
            key={`h${r.round}`}
            className="brk-head"
            style={{ gridColumn: r.col * 2 + 1, gridRow: 1 }}
            data-round={r.round}
          >
            {r.name}
          </div>
        ))}
        {layout.rounds.map((r) => (
          <div
            key={`b${r.round}`}
            className="brk-body"
            style={{ gridColumn: r.col * 2 + 1, gridRow: 2 }}
          >
            {r.nodes.map((n) => (
              <MatchCard key={n.id} node={n} on={onPath.has(n.id)} {...s} />
            ))}
          </div>
        ))}
        {Array.from({ length: Math.max(0, cols - 1) }, (_, g) => {
          const cs = layout.connectors
            .filter((c) => c.toCol - 1 === g)
            .map((c) => ({ c, on: onPath.has(c.fromId) && onPath.has(c.toId) }))
            .sort((a, b) => Number(a.on) - Number(b.on)); // utheving tegnes sist
          return (
            <svg
              key={`g${g}`}
              className="brk-lines"
              style={{ gridColumn: g * 2 + 2, gridRow: 2 }}
              viewBox={`0 0 100 ${layout.height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {cs.map(({ c, on }) => (
                <path
                  key={`${c.fromId}-${c.toId}`}
                  className={on ? "on" : undefined}
                  d={`M0 ${c.fromY} H50 V${c.toY} H100`}
                  vectorEffect="non-scaling-stroke"
                  fill="none"
                />
              ))}
            </svg>
          );
        })}
      </div>
      {layout.extras.length > 0 && (
        <div className="brk-extras">
          {layout.extras.map((n) => (
            <div className="brk-extra" key={n.id}>
              <div className="brk-head brk-head-bronze">{no.board.bronze}</div>
              <div className="brk-extra-body">
                <MatchCard node={n} on={onPath.has(n.id)} inline {...s} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MatchCard({
  node,
  on,
  inline,
  byId,
  teams,
  scoring,
  focus,
  pinned,
  onHover,
  onPin,
}: {
  node: LayoutNode;
  on: boolean;
  inline?: boolean;
} & Shared) {
  const m = byId.get(node.id);
  if (!m) return null;
  const r = m.result ? resolve(scoring.profile, m.result) : null;
  const time = m.status === "scheduled" || m.status === "called" ? matchTime(m.scheduled_at) : null;
  const rowProps = { teams, focus, pinned, onHover, onPin };
  return (
    <div
      className={`brk-m status-${m.status}${on ? " on" : ""}${inline ? " inline" : ""}`}
      style={inline ? undefined : { top: `calc(${node.y} * var(--brk-u))` }}
    >
      <div className="brk-meta">
        <span className="brk-code">{node.code}</span>
        {m.status === "live" && (
          <span className="brk-state live">
            <span className="dot" />
            {no.control.live}
          </span>
        )}
        {m.status === "called" && (
          <span className="brk-state called">{no.board.calledUp}</span>
        )}
        {time && <span className="match-time">{time}</span>}
      </div>
      <Row
        teamId={m.home_team_id}
        origin={node.home}
        score={r?.homeScore}
        win={!!m.winner_team_id && m.winner_team_id === m.home_team_id}
        bye={m.status === "bye"}
        {...rowProps}
      />
      <Row
        teamId={m.away_team_id}
        origin={node.away}
        score={r?.awayScore}
        win={!!m.winner_team_id && m.winner_team_id === m.away_team_id}
        bye={m.status === "bye"}
        {...rowProps}
      />
    </div>
  );
}

function Row({
  teamId,
  origin,
  score,
  win,
  bye,
  teams,
  focus,
  pinned,
  onHover,
  onPin,
}: {
  teamId: string | null;
  origin: SlotOrigin | null;
  score: number | undefined;
  win: boolean;
  bye: boolean;
} & Pick<Shared, "teams" | "focus" | "pinned" | "onHover" | "onPin">) {
  const team = teamId ? teams.get(teamId) : null;
  if (!team)
    return (
      <div className="brk-row">
        <span className="bx-tbd">
          {bye ? no.board.bye : (origin?.label ?? no.board.tbd)}
        </span>
      </div>
    );
  return (
    <button
      type="button"
      className={`brk-row brk-team${win ? " win" : ""}${focus === team.id ? " sel" : ""}`}
      aria-pressed={pinned === team.id}
      // Mus: hover. Touch: kun trykk (pointerType-sjekken hindrer at et trykk setter hover).
      onPointerEnter={(e) => e.pointerType === "mouse" && onHover(team.id)}
      onFocus={() => onHover(team.id)}
      onBlur={() => onHover(null)}
      onClick={() => onPin(team.id)}
    >
      <span className="team">
        {team.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="team-logo brk-logo" src={team.logo_url} alt="" />
        ) : (
          <span className="team-swatch brk-swatch" style={{ background: team.colour }} />
        )}
        <span className="team-name">{team.name}</span>
      </span>
      {score != null && <span className="bx-score">{score}</span>}
    </button>
  );
}
