// Dobbel utslag (ren modul — ingen DB): vinnerbrakett (W), taperbrakett (L) og
// storfinale (GF) med valgfri omkamp. Et lag er ute etter to tap.
//
// Formen følger vanlig dobbel utslag, slik brackets-manager.js (MIT, Drarig29) og
// nadersafa1/double-elimination (MIT) bygger den: taperne av W-runde 1 spiller
// mot hverandre i L1, så møter vinnerne taperne av W-runde 2 (L2), osv. Rekkefølgen
// taperne slippes inn i L snus annenhver gang, så de sjelden møter et lag de
// allerede har spilt. Ingen kode er portet, bare idéen — se THIRD-PARTY-NOTICES.md.
//
// Alt uttrykkes som kamper + koblinger (`feed: winner | loser`), så eksisterende
// propagering (`propagate_playoff_result`) og tidsplan virker uten egen logikk.
// Unntaket er omkampen: se `grandFinalAction`.
//
// Frirunder: W-runde 1 har frirunder når antall lag ikke er en toerpotens. Et lag
// med frirunde taper ingenting, så plassen i L som taperen ville fylt er tom. Det
// vet vi når braketten bygges, så tomme plasser løses her: en L-kamp med bare én
// mulig deltaker utgår, og den ene deltakeren går rett videre til neste L-kamp.
// Ingen lag venter dermed på en motstander som aldri kommer.

import { buildBracket, type BuiltBracket, type BuiltMatch } from "@/lib/tournament/bracket";
import type { BracketSet, CrossLink } from "@/lib/tournament/consolation";

/** Minste og største antall lag dobbel utslag bygges for. */
export const DOUBLE_ELIM_MIN_TEAMS = 3;
export const DOUBLE_ELIM_MAX_TEAMS = 32;

export interface DoubleElimOptions {
  /** Omkamp i finalen hvis taperbraketten vinner (default true). */
  grandFinalReset?: boolean;
}

/** Hvor et lag i L kommer fra: taperen av en W-kamp, eller vinneren av en L-kamp. */
interface Src {
  from: "W" | "L";
  feed: "loser" | "winner";
  round: number;
  slot: number; // for L: «virtuell» slot før tomme kamper er fjernet
}

const key = (r: number, s: number) => `${r}:${s}`;

/** Bygg vinnerbrakett, taperbrakett og storfinale fra seedede lag (indeks 0 = seed 1). */
export function buildDoubleElim(seeds: string[], opts: DoubleElimOptions = {}): BracketSet {
  const n = seeds.length;
  if (n < DOUBLE_ELIM_MIN_TEAMS)
    throw new Error(`Dobbel utslag krever minst ${DOUBLE_ELIM_MIN_TEAMS} lag.`);
  const reset = opts.grandFinalReset !== false;

  const w = buildBracket(seeds);
  const k = w.rounds;
  const size = 2 ** k;
  const wByKey = new Map(w.matches.map((m) => [key(m.round, m.slot), m]));
  // Bare W-kamper som faktisk spilles gir en taper (frirunder gjør ikke det).
  const loserOf = (round: number, slot: number): Src | null =>
    wByKey.get(key(round, slot))!.status === "bye"
      ? null
      : { from: "W", feed: "loser", round, slot };

  // ---- L: virtuelt tre med alle plasser, så fjernes tomme kamper ----
  const lRounds = 2 * (k - 1);
  const countIn = (r: number) => size / 2 ** (Math.ceil(r / 2) + 1);

  const resolved = new Map<string, Src | null>();
  const real = new Map<string, [Src, Src]>(); // ekte L-kamp → kildene (hjemme, borte)

  function inputs(r: number, s: number): [Src | null, Src | null] {
    if (r === 1) return [loserOf(1, 2 * s), loserOf(1, 2 * s + 1)];
    if (r % 2 === 0) {
      // Inndroppsrunde j: vinneren fra forrige L-runde møter taperen av W-runde j+1.
      // Rekkefølgen snus i hver andre inndroppsrunde mot omkamper.
      const j = r / 2;
      const c = countIn(r);
      return [resolveL(r - 1, s), loserOf(j + 1, j % 2 === 1 ? c - 1 - s : s)];
    }
    return [resolveL(r - 1, 2 * s), resolveL(r - 1, 2 * s + 1)];
  }

  function resolveL(r: number, s: number): Src | null {
    const k0 = key(r, s);
    if (resolved.has(k0)) return resolved.get(k0)!;
    const ins = inputs(r, s);
    const present = ins.filter((x): x is Src => x !== null);
    let out: Src | null;
    if (present.length === 0) out = null;
    else if (present.length === 1) out = present[0]; // utgår: den ene går rett videre
    else {
      real.set(k0, ins as [Src, Src]);
      out = { from: "L", feed: "winner", round: r, slot: s };
    }
    resolved.set(k0, out);
    return out;
  }

  const lMatches: BuiltMatch[] = [];
  const newSlot = new Map<string, number>();
  for (let r = 1; r <= lRounds; r++) {
    let next = 0;
    for (let s = 0; s < countIn(r); s++) {
      resolveL(r, s);
      if (!real.has(key(r, s))) continue;
      newSlot.set(key(r, s), next);
      lMatches.push({
        round: r, slot: next++, homeId: null, awayId: null,
        status: "scheduled", winnerId: null,
      });
    }
  }

  const cross: CrossLink[] = [];
  const lLinks: BuiltBracket["links"] = [];
  for (const [k0, srcs] of real) {
    const [r] = k0.split(":").map(Number);
    const toSlot = newSlot.get(k0)!;
    srcs.forEach((src, i) => {
      const toSide = i === 0 ? "home" : "away";
      if (src.from === "W") {
        cross.push({
          fromBracket: "W", fromRound: src.round, fromSlot: src.slot,
          toBracket: "L", toRound: r, toSlot, toSide, feed: "loser",
        });
      } else {
        lLinks.push({
          fromRound: src.round, fromSlot: newSlot.get(key(src.round, src.slot))!,
          toRound: r, toSlot, toSide, feed: "winner",
        });
      }
    });
  }
  const lBracket: BuiltBracket = { matches: lMatches, links: lLinks, rounds: lRounds };

  // ---- Storfinale: W-vinneren (hjemme) mot L-vinneren (borte) ----
  const lChamp = resolveL(lRounds, 0)!;
  const gfMatch = (round: number): BuiltMatch => ({
    round, slot: 0, homeId: null, awayId: null, status: "scheduled", winnerId: null,
  });
  const gfMatches = reset ? [gfMatch(1), gfMatch(2)] : [gfMatch(1)];
  cross.push({
    fromBracket: "W", fromRound: k, fromSlot: 0,
    toBracket: "GF", toRound: 1, toSlot: 0, toSide: "home", feed: "winner",
  });
  cross.push(
    lChamp.from === "L"
      ? {
          fromBracket: "L", fromRound: lChamp.round, fromSlot: newSlot.get(key(lChamp.round, lChamp.slot))!,
          toBracket: "GF", toRound: 1, toSlot: 0, toSide: "away", feed: "winner",
        }
      : {
          fromBracket: "W", fromRound: lChamp.round, fromSlot: lChamp.slot,
          toBracket: "GF", toRound: 1, toSlot: 0, toSide: "away", feed: "loser",
        },
  );
  // Omkampen mates av finalen selv: vinneren (hjemme) og taperen (borte). Vinner
  // W-laget finalen, utgår omkampen (se `grandFinalAction`).
  const gfLinks: BuiltBracket["links"] = reset
    ? [
        { fromRound: 1, fromSlot: 0, toRound: 2, toSlot: 0, toSide: "home", feed: "winner" },
        { fromRound: 1, fromSlot: 0, toRound: 2, toSlot: 0, toSide: "away", feed: "loser" },
      ]
    : [];

  return {
    brackets: [
      { id: "W", bracket: w },
      { id: "L", bracket: lBracket },
      { id: "GF", bracket: { matches: gfMatches, links: gfLinks, rounds: gfMatches.length } },
    ],
    cross,
  };
}

/** Hva som skjer med omkampen når storfinalen (GF runde 1) har fått vinner.
 *   void    — W-laget (hjemme) vant: turneringen er avgjort, omkampen utgår.
 *   restore — L-laget vant: omkampen skal spilles (gjenåpnes hvis den var utgått).
 *   null    — ingen omkamp i denne turneringen (eller ingen vinner ennå). */
export function grandFinalAction(
  gf1: { home_team_id: string | null; winner_team_id: string | null },
  hasReset: boolean,
): "void" | "restore" | null {
  if (!hasReset || !gf1.winner_team_id) return null;
  return gf1.winner_team_id === gf1.home_team_id ? "void" : "restore";
}
