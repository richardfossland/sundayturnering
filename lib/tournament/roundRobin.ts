// Round-robin scheduling (spec §7) — circle method. Pure: takes team ids, emits
// ordered pairings. No DB, no UI.
//
//   N teams → N-1 rounds (single), 2(N-1) rounds (double).
//   Odd N → a phantom "bye" slot rotates so exactly one real team sits out per
//   round, distributed fairly across teams.
//   Parallel mode spreads a round's matches across courts; sequential leaves
//   court assignment null and just orders the global queue.

export interface RRPairing {
  round: number; // 1-based
  homeId: string;
  awayId: string | null; // null = this team has the bye this round
  queueOrder: number; // global 0-based ordering of "next up"
  courtIndex: number | null; // 0-based court for parallel mode, else null
}

export interface RROptions {
  double?: boolean; // home/away double round-robin
  courtCount?: number; // >0 → parallel: spread each round across this many courts
}

const BYE = "__bye__";

/** Generate the full round-robin pairing list for the given team ids. */
export function generateRoundRobin(
  teamIds: string[],
  opts: RROptions = {},
): RRPairing[] {
  const { double = false, courtCount = 0 } = opts;
  if (teamIds.length < 2) return [];

  // Circle method needs an even count; pad with a phantom for odd N.
  const teams = [...teamIds];
  if (teams.length % 2 !== 0) teams.push(BYE);
  const n = teams.length;
  const roundsPerLeg = n - 1;
  const half = n / 2;

  // `fixed` stays put; the rest rotate clockwise each round.
  const arr = [...teams];
  const legs = double ? 2 : 1;

  const pairings: RRPairing[] = [];
  let queueOrder = 0;

  for (let leg = 0; leg < legs; leg++) {
    for (let r = 0; r < roundsPerLeg; r++) {
      const round = leg * roundsPerLeg + r + 1;
      // Build this round's matchups from the current ring.
      const roundMatches: { homeId: string; awayId: string | null }[] = [];
      for (let i = 0; i < half; i++) {
        let a = arr[i];
        let b = arr[n - 1 - i];
        // On the second leg, swap home/away for variety (home & away).
        if (leg === 1) [a, b] = [b, a];
        if (a === BYE) roundMatches.push({ homeId: b, awayId: null });
        else if (b === BYE) roundMatches.push({ homeId: a, awayId: null });
        else roundMatches.push({ homeId: a, awayId: b });
      }

      // Assign queue order + court within the round. Byes don't take a court.
      let courtCursor = 0;
      for (const m of roundMatches) {
        const isBye = m.awayId === null;
        const courtIndex =
          !isBye && courtCount > 0 ? courtCursor % courtCount : null;
        if (!isBye && courtCount > 0) courtCursor++;
        pairings.push({
          round,
          homeId: m.homeId,
          awayId: m.awayId,
          queueOrder: queueOrder++,
          courtIndex,
        });
      }

      rotate(arr);
    }
  }

  return pairings;
}

/** Rotate all but the first element clockwise (circle method step). */
function rotate(arr: string[]): void {
  // [a, b, c, d, e, f] → [a, f, b, c, d, e]
  const last = arr.pop()!;
  arr.splice(1, 0, last);
}

/** How many rounds a round-robin will have, for UI preview. */
export function roundRobinRoundCount(teamCount: number, double = false): number {
  if (teamCount < 2) return 0;
  const n = teamCount % 2 === 0 ? teamCount : teamCount + 1;
  return (n - 1) * (double ? 2 : 1);
}

/** Total match count (excluding byes), for UI preview. */
export function roundRobinMatchCount(teamCount: number, double = false): number {
  if (teamCount < 2) return 0;
  const single = (teamCount * (teamCount - 1)) / 2;
  return single * (double ? 2 : 1);
}
