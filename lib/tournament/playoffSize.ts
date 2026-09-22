// Knockout size for "Liga + sluttspill": a bracket of 2, 4, 8 or 16. The
// wizard used to send min(chosen, teams) — 3 teams at the default of 4 sent
// 3, which the server silently turned into 0, and "Start sluttspill" later
// failed with "Sluttspill er ikke konfigurert". Both sides now clamp DOWN to
// the largest valid size that fits.

export const PLAYOFF_SIZES = [16, 8, 4, 2] as const;
export type PlayoffSize = 0 | (typeof PLAYOFF_SIZES)[number];

export function clampPlayoffSize(requested: unknown, teamCount: number): PlayoffSize {
  const n = typeof requested === "number" ? requested : Number(requested);
  if (!Number.isFinite(n) || n < 2) return 0;
  return PLAYOFF_SIZES.find((s) => s <= n && s <= teamCount) ?? 0;
}

/** Group stage: every group needs at least two teams. */
export function clampGroupCount(requested: number, teamCount: number): number {
  return Math.max(2, Math.min(requested, 8, Math.floor(teamCount / 2)));
}
