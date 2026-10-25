// Brakett-layout (ren): runder → kolonner, vertikale posisjoner, forbindelses-
// linjer, rundenavn og «Vinner av SF1»-etiketter for ikke-avgjorte plasser.
//
// Teknikken (kolonne per runde, hver kamp midt mellom sine to matere, linjer
// mellom kolonnene) er inspirert av brackets-viewer.js (MIT, Drarig29) og
// brackets-manager. Ingen kode er portet; kun ideen.
//
// Modulen er DB-agnostisk og tar flere braketter (`BracketInput[]`): i dag én
// («A» + bronsefinale som egen liten seksjon), senere B-sluttspill og dobbel
// utslag som egne braketter gjennom samme komponent.
//
// Koordinater: y er i «kamprad-enheter» fra toppen av brakettlegemet (første
// runde: hver kamp tar 1 enhet, sentrum på n + 0.5). Komponenten gjør enheten om
// til CSS-lengde, så layouten er uavhengig av piksler.

import { no } from "@/lib/locale/no";
import { BRONZE_SLOT } from "@/lib/tournament/bracket";
import type { BracketLink, Match } from "@/lib/types";

export type LayoutMatch = Pick<Match, "id" | "round" | "bracket_slot">;
export type LayoutLink = Pick<
  BracketLink,
  "from_match_id" | "to_match_id" | "to_slot" | "feed"
>;

export interface BracketInput {
  id: string;
  label: string;
  matches: LayoutMatch[];
  links: LayoutLink[];
}

/** Hvor en ikke-avgjort plass kommer fra («Vinner av SF1»). */
export interface SlotOrigin {
  fromId: string;
  feed: "winner" | "loser";
  label: string;
}

export interface LayoutNode {
  id: string;
  round: number;
  col: number; // 0-basert kolonne (kun hovedbrakett; 0 for ekstra-kamper)
  y: number; // sentrum, kamprad-enheter
  code: string; // kort kode: F, SF1, KF2 …
  home: SlotOrigin | null;
  away: SlotOrigin | null;
}

export interface LayoutRound {
  round: number;
  col: number;
  name: string;
  nodes: LayoutNode[];
}

export interface LayoutConnector {
  fromId: string;
  toId: string;
  fromCol: number;
  toCol: number;
  fromY: number;
  toY: number;
}

export interface BracketLayout {
  id: string;
  label: string;
  rounds: LayoutRound[];
  /** Kamper som ikke hører i selve treet (bronsefinale: kun tapere som mater). */
  extras: LayoutNode[];
  connectors: LayoutConnector[];
  /** Total høyde i kamprad-enheter. */
  height: number;
}

/** Kobling for et standard enkelt utslag når radene ikke har noen (bygger
 * `buildBracket`-regelen: runde r slot i → runde r+1 slot ⌊i/2⌋, partall = hjemme)
 * pluss tapere fra semifinalene til bronsefinalen. */
export function inferLinks(matches: LayoutMatch[]): LayoutLink[] {
  const at = new Map<string, LayoutMatch>();
  for (const m of matches) at.set(`${m.round}:${m.bracket_slot ?? 0}`, m);
  const maxRound = Math.max(0, ...matches.map((m) => m.round));
  const links: LayoutLink[] = [];
  for (const m of matches) {
    const slot = m.bracket_slot ?? 0;
    const isBronze = m.round === maxRound && slot === BRONZE_SLOT && maxRound >= 2;
    if (isBronze) continue;
    const to = at.get(`${m.round + 1}:${Math.floor(slot / 2)}`);
    if (!to) continue;
    links.push({
      from_match_id: m.id,
      to_match_id: to.id,
      to_slot: slot % 2 === 0 ? "home" : "away",
      feed: "winner",
    });
  }
  const bronze = at.get(`${maxRound}:${BRONZE_SLOT}`);
  const sf0 = at.get(`${maxRound - 1}:0`);
  const sf1 = at.get(`${maxRound - 1}:1`);
  if (maxRound >= 2 && bronze && sf0 && sf1) {
    links.push(
      { from_match_id: sf0.id, to_match_id: bronze.id, to_slot: "home", feed: "loser" },
      { from_match_id: sf1.id, to_match_id: bronze.id, to_slot: "away", feed: "loser" },
    );
  }
  return links;
}

/** Rundenavn gitt hvor mange runder braketten har. */
export function roundName(col: number, cols: number): string {
  const fromEnd = cols - 1 - col;
  if (fromEnd === 0) return no.board.final;
  if (fromEnd === 1) return no.board.semifinal;
  if (fromEnd === 2) return no.board.quarterfinal;
  if (fromEnd === 3) return no.board.roundOf16;
  return `${no.board.round} ${col + 1}`;
}

function roundCode(col: number, cols: number, index: number, count: number): string {
  const fromEnd = cols - 1 - col;
  const n = index + 1;
  if (fromEnd === 0) return count === 1 ? "F" : `F${n}`;
  if (fromEnd === 1) return `SF${n}`;
  if (fromEnd === 2) return `KF${n}`;
  if (fromEnd === 3) return `ÅF${n}`;
  return `R${col + 1}-${n}`;
}

const bySlot = (a: LayoutMatch, b: LayoutMatch) =>
  (a.bracket_slot ?? 0) - (b.bracket_slot ?? 0) || a.id.localeCompare(b.id);

/** Layout for én brakett. */
export function layoutBracket(input: BracketInput): BracketLayout {
  const { id, label, matches, links } = input;
  const byId = new Map(matches.map((m) => [m.id, m]));
  const known = links.filter(
    (l) => byId.has(l.from_match_id) && byId.has(l.to_match_id),
  );
  const incoming = new Map<string, LayoutLink[]>();
  for (const l of known) {
    const arr = incoming.get(l.to_match_id) ?? [];
    arr.push(l);
    incoming.set(l.to_match_id, arr);
  }

  // En kamp som KUN mates av tapere (bronsefinale) står utenfor treet.
  const isExtra = (m: LayoutMatch) => {
    const inc = incoming.get(m.id);
    return !!inc && inc.length > 0 && inc.every((l) => l.feed === "loser");
  };
  const main = matches.filter((m) => !isExtra(m));
  const extraMatches = matches.filter(isExtra).sort(bySlot);

  const roundNos = [...new Set(main.map((m) => m.round))].sort((a, b) => a - b);
  const cols = roundNos.length;
  const colOf = new Map(roundNos.map((r, i) => [r, i]));
  const minRound = roundNos[0] ?? 1;

  // Vertikale posisjoner: kolonne for kolonne, hver kamp midt mellom matere.
  const yOf = new Map<string, number>();
  const rounds: LayoutRound[] = [];
  const codeOf = new Map<string, string>();
  roundNos.forEach((round, col) => {
    const ms = main.filter((m) => m.round === round).sort(bySlot);
    let prev = -Infinity;
    let leaf = 0;
    const ys = ms.map((m) => {
      const feeders = (incoming.get(m.id) ?? [])
        .filter((l) => l.feed === "winner" && yOf.has(l.from_match_id))
        .map((l) => yOf.get(l.from_match_id)!);
      let y: number;
      if (feeders.length > 0) {
        y = feeders.reduce((s, v) => s + v, 0) / feeders.length;
      } else if (col === 0) {
        y = leaf++ + 0.5;
      } else {
        // Uten matere midt i treet: der standardrutenettet ville plassert den.
        y = ((m.bracket_slot ?? 0) + 0.5) * 2 ** (round - minRound);
      }
      // Aldri tettere enn 1 enhet (sikrer monotone, ikke-overlappende kort).
      y = Math.max(y, prev + 1);
      prev = y;
      yOf.set(m.id, y);
      return y;
    });
    const nodes: LayoutNode[] = ms.map((m, i) => {
      const code = roundCode(col, cols, i, ms.length);
      codeOf.set(m.id, code);
      return { id: m.id, round, col, y: ys[i], code, home: null, away: null };
    });
    rounds.push({ round, col, name: roundName(col, cols), nodes });
  });

  const extras: LayoutNode[] = extraMatches.map((m, i) => {
    codeOf.set(m.id, extraMatches.length === 1 ? "BF" : `BF${i + 1}`);
    return { id: m.id, round: m.round, col: 0, y: 0.5, code: codeOf.get(m.id)!, home: null, away: null };
  });

  // Opprinnelsesetiketter for plasser som ikke er fylt av en kobling-kilde ennå.
  const origin = (toId: string, side: "home" | "away"): SlotOrigin | null => {
    const l = (incoming.get(toId) ?? []).find((x) => x.to_slot === side);
    if (!l) return null;
    const code = codeOf.get(l.from_match_id);
    if (!code) return null;
    return {
      fromId: l.from_match_id,
      feed: l.feed,
      label: l.feed === "loser" ? no.board.loserOf(code) : no.board.winnerOf(code),
    };
  };
  for (const n of [...rounds.flatMap((r) => r.nodes), ...extras]) {
    n.home = origin(n.id, "home");
    n.away = origin(n.id, "away");
  }

  const connectors: LayoutConnector[] = [];
  for (const l of known) {
    if (l.feed !== "winner") continue;
    const from = byId.get(l.from_match_id)!;
    const to = byId.get(l.to_match_id)!;
    const fromCol = colOf.get(from.round);
    const toCol = colOf.get(to.round);
    if (fromCol == null || toCol == null || toCol <= fromCol) continue;
    connectors.push({
      fromId: from.id,
      toId: to.id,
      fromCol,
      toCol,
      fromY: yOf.get(from.id)!,
      toY: yOf.get(to.id)!,
    });
  }

  const maxY = Math.max(0, ...[...yOf.values()]);
  return { id, label, rounds, extras, connectors, height: Math.max(1, maxY + 0.5) };
}

/** Layout for alle braketter (A, senere B / taperbrakett / finale). */
export function layoutBrackets(brackets: BracketInput[]): BracketLayout[] {
  return brackets.map(layoutBracket);
}
