// Beregnet sluttid for veiviseren: «Siste kamp ferdig ca. kl. …». Ren modul —
// bygger de samme kampene serveren ville bygd (rundeturnering / braketter) med
// plassholder-lag, og kjører dem gjennom tidsplan-motoren (`planSlots`).
//
// Det er et anslag, ikke et løfte: sluttspill i liga/gruppespill bygges først
// når serien er ferdig (her antatt uten forsinkelser), og i sveitsisk system
// settes hver runde opp når den forrige er ferdig (her: samme antall kamper
// hver runde).

import type { Consolation, Format, ScheduleConfig } from "@/lib/types";
import { planRoundRobins } from "@/lib/tournament/roundRobin";
import { splitIntoGroups, seedKnockoutFromGroups } from "@/lib/tournament/groups";
import {
  bSeedsFromGroups,
  bSeedsFromLeague,
  buildCupConsolationSet,
  buildPlayoffSet,
  type BracketSet,
} from "@/lib/tournament/consolation";
import { buildDoubleElim, doubleElimOrder } from "@/lib/tournament/doubleElim";
import { planSlots, type SlotLink, type SlotMatch } from "@/lib/tournament/schedule";

const MIN = 60_000;

export interface EstimateInput {
  format: Format;
  teamCount: number;
  /** Antall baner; 0 = sekvensiell (én felles tidslinje). */
  courtCount: number;
  schedule: ScheduleConfig;
  /** Lag som går videre (liga + sluttspill); allerede klemt mot antall lag. */
  playoffSize?: number;
  groupCount?: number;
  advancePerGroup?: number;
  thirdPlace?: boolean;
  consolation?: Consolation;
  grandFinalReset?: boolean;
  swissRounds?: number;
}

export interface Estimate {
  /** Når siste kamp er ferdig (ISO); null hvis starttiden er ugyldig eller det ikke er kamper. */
  endsAt: string | null;
  /** Kamper som er med i anslaget (uten frirunder). */
  matchCount: number;
}

const ids = (n: number, prefix = "t") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** Kamper + koblinger for et brakettsett, i samme spillerekkefølge som serveren bruker. */
function bracketRows(
  set: BracketSet,
  order?: (bracket: string, round: number) => number,
): { rows: SlotMatch[]; links: SlotLink[] } {
  const flat = set.brackets.flatMap(({ id, bracket }, bi) =>
    bracket.matches.map((m) => ({ id, bi, m })),
  );
  const at = (id: string, round: number) => order?.(id, round) ?? round;
  flat.sort((x, y) => at(x.id, x.m.round) - at(y.id, y.m.round) || x.bi - y.bi || x.m.slot - y.m.slot);
  const key = (b: string, r: number, s: number) => `${b}:${r}:${s}`;
  const rows: SlotMatch[] = flat.map(({ id, m }, i) => ({
    id: key(id, m.round, m.slot),
    queue_order: i,
    court_id: null,
    home_team_id: m.homeId,
    away_team_id: m.awayId,
    status: m.status === "bye" ? "bye" : "scheduled",
  }));
  const links: SlotLink[] = [
    ...set.brackets.flatMap(({ id, bracket }) =>
      bracket.links.map((l) => ({
        from_match_id: key(id, l.fromRound, l.fromSlot),
        to_match_id: key(id, l.toRound, l.toSlot),
      })),
    ),
    ...set.cross.map((c) => ({
      from_match_id: key(c.fromBracket, c.fromRound, c.fromSlot),
      to_match_id: key(c.toBracket, c.toRound, c.toSlot),
    })),
  ];
  return { rows, links };
}

export function estimateEnd(input: EstimateInput): Estimate {
  const { format, teamCount, schedule } = input;
  const courts = ids(Math.max(0, input.courtCount), "c");
  const start = Date.parse(schedule.startAt);
  if (!Number.isFinite(start) || teamCount < 2) return { endsAt: null, matchCount: 0 };

  let matchCount = 0;
  let end = start;
  // Lagenes siste sluttidspunkt føres videre mellom fasene (serie → sluttspill,
  // sveitsisk runde → neste), som `priorEnds` gjør i serverens bygging.
  const teamEnds = new Map<string, number>();
  /** Kjør en gruppe kamper og flytt `end` til siste sluttidspunkt. */
  const run = (rows: SlotMatch[], links: SlotLink[] = [], notBefore?: number) => {
    const planned = planSlots(rows, courts, schedule, {
      links,
      notBefore: notBefore !== undefined ? new Date(notBefore) : undefined,
      priorEnds: teamEnds,
      endsOut: teamEnds,
    });
    matchCount += planned.size;
    for (const p of planned.values())
      end = Math.max(end, Date.parse(p.at) + schedule.matchMinutes * MIN);
  };
  // Som serverens bygging med tidsplan: banen er ikke forhåndssatt (planleggeren
  // velger), og gruppene deler én kø runde for runde.
  const rr = (groups: string[][]): SlotMatch[] =>
    planRoundRobins(groups).map((p) => ({
      id: `rr:${p.queueOrder}`,
      queue_order: p.queueOrder,
      court_id: null,
      home_team_id: p.homeId,
      away_team_id: p.awayId,
      status: p.awayId === null ? "bye" : "scheduled",
    }));

  if (format === "cup") {
    const seeds = ids(teamCount);
    const set =
      input.consolation === "first_round_losers"
        ? buildCupConsolationSet(seeds, { thirdPlace: input.thirdPlace })
        : buildPlayoffSet(seeds, { thirdPlace: input.thirdPlace });
    const { rows, links } = bracketRows(set);
    run(rows, links);
  } else if (format === "double_elim") {
    const set = buildDoubleElim(ids(teamCount), { grandFinalReset: input.grandFinalReset });
    const { rows, links } = bracketRows(set, doubleElimOrder);
    run(rows, links);
  } else if (format === "swiss") {
    // Hver runde parres først når forrige er ferdig: kjør runde for runde.
    const pairs = Math.floor(teamCount / 2);
    for (let r = 0; r < (input.swissRounds ?? 1); r++) {
      const rows: SlotMatch[] = Array.from({ length: pairs }, (_, i) => ({
        id: `s${r}:${i}`,
        queue_order: i,
        court_id: null,
        home_team_id: `t${2 * i}`,
        away_team_id: `t${2 * i + 1}`,
        status: "scheduled",
      }));
      run(rows, [], end);
    }
  } else if (format === "group_playoff") {
    const groups = splitIntoGroups(ids(teamCount), input.groupCount ?? 2);
    run(rr(groups));
    const per = input.advancePerGroup ?? 2;
    const qualifiers = seedKnockoutFromGroups(groups.map((g) => g.slice(0, per)));
    const bSeeds =
      input.consolation === "b_playoff" ? bSeedsFromGroups(groups, per) : undefined;
    const { rows: pr, links } = bracketRows(
      buildPlayoffSet(qualifiers, { thirdPlace: input.thirdPlace, bSeeds }),
    );
    run(pr, links, end);
  } else {
    // liga / liga + sluttspill
    run(rr([ids(teamCount)]));
    const size = input.playoffSize ?? 0;
    if (format === "league_playoff" && size >= 2) {
      const ranked = ids(teamCount);
      const bSeeds =
        input.consolation === "b_playoff" ? bSeedsFromLeague(ranked, size) : undefined;
      const { rows, links } = bracketRows(
        buildPlayoffSet(ranked.slice(0, size), { thirdPlace: input.thirdPlace, bSeeds }),
      );
      run(rows, links, end);
    }
  }

  return matchCount > 0 ? { endsAt: new Date(end).toISOString(), matchCount } : { endsAt: null, matchCount: 0 };
}
