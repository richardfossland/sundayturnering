// Ekstra sluttspill for lag som er ute / ikke kom videre (ren modul — ingen DB).
//
//   - «B-sluttspill for resten» (liga/gruppe + sluttspill): lagene under
//     kvalifiseringsgrensen får en egen enkel utslagsbrakett seedet etter tabellen.
//   - «Trøsterunde» (cup): taperne av første runde (uten frirunder) møtes i en B-brakett.
//
// Idéen er hentet fra brackets-manager.js (`consolationFinal`) og CourtHive
// tods-competition-factory (`firstRoundLoserConsolation`), begge MIT — se
// THIRD-PARTY-NOTICES.md. Ingen kode er portet; byggingen gjenbruker `buildBracket`.

import { buildBracket, type BuiltBracket } from "@/lib/tournament/bracket";
import { seedKnockoutFromGroups, type GroupRecord } from "@/lib/tournament/groups";
import type { BracketId, Consolation, Format } from "@/lib/types";

export const CONSOLATIONS: readonly Consolation[] = ["none", "b_playoff", "first_round_losers"];

/** Hvilke valg som gir mening for et format (veiviseren viser bare disse). */
export function consolationOptions(format: Format): Consolation[] {
  if (format === "cup") return ["none", "first_round_losers"];
  if (format === "league_playoff" || format === "group_playoff") return ["none", "b_playoff"];
  return ["none"];
}

/** Rå input → gyldig verdi. `undefined` = ikke sendt; "invalid" = ukjent verdi eller
 * et valg som ikke passer formatet (avvises av ruta). */
export function sanitiseConsolation(
  raw: unknown,
  format: Format,
): Consolation | undefined | "invalid" {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || !CONSOLATIONS.includes(raw as Consolation)) return "invalid";
  return consolationOptions(format).includes(raw as Consolation) ? (raw as Consolation) : "invalid";
}

/** Alle brakettene i et sluttspill, pluss koblinger MELLOM dem (taper av A → B). */
export interface CrossLink {
  fromBracket: BracketId;
  fromRound: number;
  fromSlot: number;
  toBracket: BracketId;
  toRound: number;
  toSlot: number;
  toSide: "home" | "away";
  feed: "winner" | "loser";
}

export interface BracketSet {
  brackets: { id: BracketId; bracket: BuiltBracket }[];
  cross: CrossLink[];
}

/** Lagene som ikke kom til A, i B-seed-rekkefølge. Liga: tabellrekkefølge etter
 * grensen. Grupper: de som falt ut i hver gruppe, krysseedet som A (alle som var
 * nr. 3 i gruppa først, så nr. 4 osv.; innen hvert nivå etter rekord, og lag fra
 * samme gruppe holdes fra hverandre). */
export function bSeedsFromLeague(ranked: string[], playoffSize: number): string[] {
  return ranked.slice(playoffSize);
}
export function bSeedsFromGroups(
  perGroupRanked: string[][],
  advancePerGroup: number,
  records?: ReadonlyMap<string, GroupRecord>,
): string[] {
  return seedKnockoutFromGroups(
    perGroupRanked.map((g) => g.slice(advancePerGroup)),
    records,
  );
}

/** A (+ evt. B) fra seedede lag etter liga/gruppespill. B krever minst 2 lag. */
export function buildPlayoffSet(
  aSeeds: string[],
  opts: { thirdPlace?: boolean; bSeeds?: string[] } = {},
): BracketSet {
  const set: BracketSet = {
    brackets: [{ id: "A", bracket: buildBracket(aSeeds, { thirdPlace: opts.thirdPlace }) }],
    cross: [],
  };
  if (opts.bSeeds && opts.bSeeds.length >= 2)
    set.brackets.push({ id: "B", bracket: buildBracket(opts.bSeeds) });
  return set;
}

/** Antall ekte første-runde-kamper i en cup med `teamCount` lag (frirunder telles ikke). */
export function firstRoundMatchCount(teamCount: number): number {
  return buildBracket(Array.from({ length: teamCount }, (_, i) => String(i))).matches.filter(
    (m) => m.round === 1 && m.status === "scheduled",
  ).length;
}

/** Trøsterunde krever minst to første-runde-tapere, og at første runde ikke
 * allerede er semifinalen (da er taperne bronsefinalen). */
export function cupConsolationFeasible(teamCount: number): boolean {
  if (teamCount < 3) return false;
  const a = buildBracket(Array.from({ length: teamCount }, (_, i) => String(i)));
  return a.rounds >= 3 && firstRoundMatchCount(teamCount) >= 2;
}

/** Cup med trøsterunde: A som vanlig; B består av førsterundetaperne. Taperen av
 * hver ekte første-runde-kamp mates inn via en `feed: "loser"`-kobling. Er antallet
 * ikke en toerpotens, får noen plasser i B frirunde: den kampen droppes, og taperen
 * går rett inn i B-runde 2 (vi vet ikke hvem som taper før A-kampen er spilt, så en
 * frirunde kan ikke forhåndsløses slik som i A). */
export function buildCupConsolationSet(
  seeds: string[],
  opts: { thirdPlace?: boolean } = {},
): BracketSet {
  const a = buildBracket(seeds, { thirdPlace: opts.thirdPlace });
  const set: BracketSet = { brackets: [{ id: "A", bracket: a }], cross: [] };
  if (!cupConsolationFeasible(seeds.length)) return set;

  const feeders = a.matches
    .filter((m) => m.round === 1 && m.status === "scheduled")
    .sort((x, y) => x.slot - y.slot);
  // Plassholdere L0..Lk-1 gir B-formen (inkl. hvor frirundene havner).
  const ph = feeders.map((_, i) => `L${i}`);
  const shape = buildBracket(ph);
  const feederOf = (id: string | null) => (id ? feeders[Number(id.slice(1))] : null);

  const keep = shape.matches.filter((m) => m.status !== "bye");
  const droppedSlots = new Set(
    shape.matches.filter((m) => m.status === "bye").map((m) => m.slot),
  );

  for (const m of shape.matches) {
    if (m.round !== 1) continue;
    for (const side of ["home", "away"] as const) {
      const f = feederOf(side === "home" ? m.homeId : m.awayId);
      if (!f) continue;
      if (m.status === "bye") {
        // Frirunde: taperen skal rett til der frirundevinneren ville gått.
        const onward = shape.links.find((l) => l.fromRound === 1 && l.fromSlot === m.slot)!;
        set.cross.push({
          fromBracket: "A", fromRound: 1, fromSlot: f.slot,
          toBracket: "B", toRound: onward.toRound, toSlot: onward.toSlot, toSide: onward.toSide,
          feed: "loser",
        });
      } else {
        set.cross.push({
          fromBracket: "A", fromRound: 1, fromSlot: f.slot,
          toBracket: "B", toRound: 1, toSlot: m.slot, toSide: side,
          feed: "loser",
        });
      }
    }
  }

  const b: BuiltBracket = {
    rounds: shape.rounds,
    matches: keep.map((m) => ({ ...m, homeId: null, awayId: null, winnerId: null })),
    links: shape.links.filter((l) => !(l.fromRound === 1 && droppedSlots.has(l.fromSlot))),
  };
  set.brackets.push({ id: "B", bracket: b });
  return set;
}

/** Avgjør hvilke brakettfinaler som ikke er spilt (ren motpart til RPC-en
 * `propagate_playoff_result`, brukt av fallback-stien og tester). En finale =
 * bracket_slot 0 uten vinner-kobling videre.
 *
 * Dobbel utslag: storfinalen (GF runde 1) har en vinner-kobling til omkampen, så
 * omkampen (GF runde 2) er «finalen» som må være avgjort. Vant W-laget (hjemme)
 * storfinalen, utgår omkampen og teller ikke som uspilt, selv om raden ennå ikke
 * er flagget `bye`. */
export function pendingFinals(
  matches: readonly {
    id: string;
    phase: string;
    bracket_slot: number | null;
    status: string;
    bracket?: string;
    round?: number;
    home_team_id?: string | null;
    winner_team_id?: string | null;
  }[],
  links: readonly { from_match_id: string; feed: string }[],
): string[] {
  const hasOnward = new Set(links.filter((l) => l.feed !== "loser").map((l) => l.from_match_id));
  const gf1 = matches.find((m) => m.bracket === "GF" && m.round === 1);
  const rematchVoid =
    !!gf1 && gf1.status === "done" && !!gf1.winner_team_id && gf1.winner_team_id === gf1.home_team_id;
  return matches
    .filter(
      (m) =>
        m.phase === "playoff" &&
        m.bracket_slot === 0 &&
        !hasOnward.has(m.id) &&
        m.status !== "done" &&
        m.status !== "bye" &&
        !(rematchVoid && m.bracket === "GF" && m.round === 2),
    )
    .map((m) => m.id);
}
