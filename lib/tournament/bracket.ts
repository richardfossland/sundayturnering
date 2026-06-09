// Single-elimination bracket (spec §7) — pure builder + winner advancement.
// Standard seeding (1 vs N, 2 vs N-1, …) so the top two seeds can only meet in
// the final; byes go to the top seeds when N is not a power of two.
//
// The builder is DB-agnostic: it emits matches keyed by (round, slot) and links
// describing where each winner flows. The server maps those keys to row ids.

export interface BuiltMatch {
  round: number; // 1 = first round
  slot: number; // 0-based position within the round
  homeId: string | null; // team id, or null = TBD
  awayId: string | null;
  status: "scheduled" | "bye";
  winnerId: string | null; // pre-resolved for byes
}

export interface BuiltLink {
  fromRound: number;
  fromSlot: number;
  toRound: number;
  toSlot: number;
  toSide: "home" | "away";
}

export interface BuiltBracket {
  matches: BuiltMatch[];
  links: BuiltLink[];
  rounds: number;
}

/** Next power of two ≥ n (min 2). */
export function bracketSize(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(2, p);
}

/** Standard tournament seed order for a bracket of size `size` (power of two).
 * Returns seed numbers 1..size in round-1 position order. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next: number[] = [];
    const sum = order.length * 2 + 1;
    for (const s of order) {
      next.push(s);
      next.push(sum - s);
    }
    order = next;
  }
  return order;
}

/** Build a single-elimination bracket from seeded team ids (index 0 = seed 1).
 * Byes (seed > N) are assigned to the top seeds and pre-resolved + propagated
 * into round 2. */
export function buildBracket(seeds: string[]): BuiltBracket {
  const n = seeds.length;
  if (n < 2) return { matches: [], links: [], rounds: 0 };

  const size = bracketSize(n);
  const order = seedOrder(size);
  const rounds = Math.log2(size);

  const matches: BuiltMatch[] = [];
  const byKey = new Map<string, BuiltMatch>();
  const key = (r: number, s: number) => `r${r}s${s}`;

  // Round 1 from the seed order.
  const half = size / 2;
  for (let slot = 0; slot < half; slot++) {
    const seedA = order[2 * slot];
    const seedB = order[2 * slot + 1];
    const homeId = seedA <= n ? seeds[seedA - 1] : null;
    const awayId = seedB <= n ? seeds[seedB - 1] : null;
    const isBye = (homeId === null) !== (awayId === null); // exactly one present
    const m: BuiltMatch = {
      round: 1,
      slot,
      homeId,
      awayId,
      status: isBye ? "bye" : "scheduled",
      winnerId: isBye ? (homeId ?? awayId) : null,
    };
    matches.push(m);
    byKey.set(key(1, slot), m);
  }

  // Subsequent rounds: empty matches fed by the previous round.
  const links: BuiltLink[] = [];
  for (let r = 2; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let slot = 0; slot < count; slot++) {
      const m: BuiltMatch = {
        round: r,
        slot,
        homeId: null,
        awayId: null,
        status: "scheduled",
        winnerId: null,
      };
      matches.push(m);
      byKey.set(key(r, slot), m);
    }
  }

  // Links: round r slot i → round r+1 slot floor(i/2), home if i even else away.
  for (let r = 1; r < rounds; r++) {
    const count = size / 2 ** r;
    for (let slot = 0; slot < count; slot++) {
      links.push({
        fromRound: r,
        fromSlot: slot,
        toRound: r + 1,
        toSlot: Math.floor(slot / 2),
        toSide: slot % 2 === 0 ? "home" : "away",
      });
    }
  }

  // Pre-propagate round-1 byes into round 2 (a bye winner advances immediately).
  for (const m of matches) {
    if (m.round === 1 && m.status === "bye" && m.winnerId) {
      const link = links.find(
        (l) => l.fromRound === 1 && l.fromSlot === m.slot,
      )!;
      const target = byKey.get(key(link.toRound, link.toSlot))!;
      if (link.toSide === "home") target.homeId = m.winnerId;
      else target.awayId = m.winnerId;
    }
  }

  // A round-2 match whose both sides were filled by byes is ready to play; one
  // filled + one TBD stays scheduled (waiting on the other match). Both null is
  // impossible because byes never collide pairwise (size is the *smallest*
  // power of two ≥ N, so byes < size/2).

  return { matches, links, rounds };
}

/** Apply a resolved match winner into the bracket (pure, for tests + parity with
 * the server's bracket_links propagation). Mutates a copy and returns it. */
export function advanceBracket(
  bracket: BuiltBracket,
  fromRound: number,
  fromSlot: number,
  winnerId: string,
): BuiltBracket {
  const matches = bracket.matches.map((m) => ({ ...m }));
  const link = bracket.links.find(
    (l) => l.fromRound === fromRound && l.fromSlot === fromSlot,
  );
  if (!link) return { ...bracket, matches };
  const target = matches.find(
    (m) => m.round === link.toRound && m.slot === link.toSlot,
  );
  if (target) {
    if (link.toSide === "home") target.homeId = winnerId;
    else target.awayId = winnerId;
  }
  return { ...bracket, matches };
}
