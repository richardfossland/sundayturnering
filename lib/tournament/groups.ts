// Group-stage helpers (pure, spec extension). Split seeded teams into balanced
// groups and seed the knockout bracket from per-group qualifiers. Kept UI- and
// DB-agnostic so they're unit-testable; the server persists the result.

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

/** Flat knockout seed list from per-group qualifiers.
 * qualifiers[groupIndex] = [winner, runnerUp, ...] (length = advancePerGroup).
 * Group winners become the top seeds (so any byes fall to them); runners-up are
 * the next tier, etc. With standard bracket seeding this keeps a group's winner
 * and runner-up on opposite halves in the common 2-group case, and avoids any
 * same-group round-one meeting more generally. */
export function seedKnockoutFromGroups(qualifiers: string[][]): string[] {
  const maxRank = Math.max(0, ...qualifiers.map((q) => q.length));
  const seeds: string[] = [];
  for (let rank = 0; rank < maxRank; rank++)
    for (const q of qualifiers) if (q[rank] != null) seeds.push(q[rank]);
  return seeds;
}
