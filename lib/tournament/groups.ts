// Group-stage helpers (pure, spec extension). Split seeded teams into balanced
// groups and seed the knockout bracket from per-group qualifiers. Kept UI- and
// DB-agnostic so they're unit-testable; the server persists the result.

import { bracketSize, seedOrder } from "@/lib/tournament/bracket";

/** Distribute seeded team ids into `groupCount` groups, serpentine so the top
 * seeds spread across groups and group sizes differ by at most one (handles a
 * group count that doesn't divide the team count). */
export function splitIntoGroups(
  teamIds: string[],
  groupCount: number,
): string[][] {
  const g = Math.max(1, Math.min(Math.floor(groupCount), teamIds.length || 1));
  const groups: string[][] = Array.from({ length: g }, () => []);
  teamIds.forEach((id, i) => {
    const row = Math.floor(i / g);
    const col = i % g;
    const idx = row % 2 === 0 ? col : g - 1 - col; // serpentine
    groups[idx].push(id);
  });
  return groups;
}

/** Et lags resultater i gruppespillet (det seedingen trenger av en tabellrad). */
export interface GroupRecord {
  played: number;
  points: number;
  diff: number;
  scored: number;
}

/** Størrelsen på ett steg i søket (antall noder) før vi tar beste funn så langt.
 * Rekkefølgen prøves fra «som seedet», så et avkortet søk gir fortsatt en grei løsning. */
const SEARCH_BUDGET = 400_000;

const perGame = (r: GroupRecord | undefined, key: "points" | "diff" | "scored") =>
  r && r.played > 0 ? r[key] / r.played : 0;

/** Runden to plasser (0-indeksert i brakettens rekkefølge) tidligst kan møtes i:
 * 1 = samme første-runde-kamp, 2 = samme kvart …, brakettens siste = finalen. */
function meetRound(p: number, q: number): number {
  return 32 - Math.clz32(p ^ q);
}

/** Flat knockout seed list from per-group qualifiers.
 * qualifiers[groupIndex] = [winner, runnerUp, ...] (length = advancePerGroup).
 *
 * Seeding is by TIER: all group winners first, then all runners-up, etc., so any
 * byes fall to the winners. Inside a tier teams are ordered by their record
 * (points per game, then goal difference per game, then goals scored per game,
 * then group order) — not by group letter — so groups of different size compare
 * fairly. `records` = each qualifier's group record; without it, group order rules.
 *
 * Winners keep their seed order. Each lower tier is then shuffled within its own
 * seed numbers to keep group-mates apart in the standard bracket: never in round 1
 * if that can be avoided, then as late as possible (for two per group, winner and
 * runner-up in opposite halves). Among equally good placements the one closest to
 * the record order wins. */
export function seedKnockoutFromGroups(
  qualifiers: string[][],
  records?: ReadonlyMap<string, GroupRecord>,
): string[] {
  const maxRank = Math.max(0, ...qualifiers.map((q) => q.length));
  const tiers: { id: string; group: number }[][] = [];
  for (let rank = 0; rank < maxRank; rank++) {
    const tier: { id: string; group: number }[] = [];
    qualifiers.forEach((q, group) => {
      if (q[rank] != null) tier.push({ id: q[rank], group });
    });
    tier.sort((a, b) => {
      const ra = records?.get(a.id);
      const rb = records?.get(b.id);
      for (const key of ["points", "diff", "scored"] as const) {
        const d = perGame(rb, key) - perGame(ra, key);
        if (Math.abs(d) > 1e-9) return d;
      }
      return a.group - b.group;
    });
    tiers.push(tier);
  }

  const n = tiers.reduce((sum, t) => sum + t.length, 0);
  if (n < 3) return tiers.flat().map((t) => t.id);

  const size = bracketSize(n);
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const pos = new Array<number>(size + 1); // seed number → plass i brakettens rekkefølge
  order.forEach((seed, i) => (pos[seed] = i));
  // Tidligere møte veier tyngre: en runde-1-kollisjon er verre enn alle senere til sammen
  // (færre enn n kollisjoner per runde, så base n+1 holder; trygt som heltall til ~100 lag).
  const base = n + 1;
  const weight = (r: number) => base ** (rounds - r);

  const placed: { pos: number; group: number }[] = [];
  const out: string[] = [];
  for (const tier of tiers) {
    const lo = out.length + 1; // første seed-nummer i dette nivået
    const k = tier.length;
    // cost[i][j]: kostnaden av å legge lag i på den j-te plassen i nivået.
    const cost = tier.map((t) =>
      Array.from({ length: k }, (_, j) => {
        let c = 0;
        for (const p of placed)
          if (p.group === t.group) c += weight(meetRound(p.pos, pos[lo + j]));
        return c;
      }),
    );
    const miss = k * k + 1; // forskyvning fra rekordrekkefølgen teller minst
    const assign = bestAssignment(cost, miss);
    assign.forEach((teamIdx, j) => {
      out.push(tier[teamIdx].id);
      placed.push({ pos: pos[lo + j], group: tier[teamIdx].group });
    });
  }
  return out;
}

/** Plassering (plass j → lag-indeks) med lavest kostnad, deretter minst forskyvning
 * fra identiteten. Dybde-først med avskjæring; faller tilbake til beste funn så
 * langt om søket blir for stort (mange grupper). */
function bestAssignment(cost: number[][], miss: number): number[] {
  const k = cost.length;
  const key = (i: number, j: number) => cost[i][j] * miss + Math.abs(i - j);
  let best = Array.from({ length: k }, (_, j) => j);
  let bestKey = best.reduce((sum, i, j) => sum + key(i, j), 0);
  const cur = new Array<number>(k);
  const used = new Array<boolean>(k).fill(false);
  let nodes = 0;
  const dfs = (j: number, sum: number) => {
    if (j === k) {
      if (sum < bestKey) {
        bestKey = sum;
        best = [...cur];
      }
      return;
    }
    for (let i = 0; i < k; i++) {
      if (used[i]) continue;
      if (++nodes > SEARCH_BUDGET) return;
      const next = sum + key(i, j);
      if (next >= bestKey) continue;
      used[i] = true;
      cur[j] = i;
      dfs(j + 1, next);
      used[i] = false;
    }
  };
  dfs(0, 0);
  return best;
}
