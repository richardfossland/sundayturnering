// Team colour palette — auto-assigned in onboarding, editable. Chosen to stay
// legible on the dark projector ground and distinct from each other.
export const PALETTE = [
  "#E0524B", // red
  "#2E7CF6", // blue
  "#36B37E", // green
  "#EBB84B", // gold (suite accent)
  "#9B59D0", // purple
  "#E8853A", // orange
  "#16B5C4", // teal
  "#E15B97", // pink
  "#5A8A4C", // olive
  "#C0563B", // rust
  "#3F51B5", // indigo
  "#7A8794", // slate
  "#D4A017", // amber
  "#1FA39A", // jade
  "#B0476B", // wine
  "#6D7BD6", // periwinkle
] as const;

/** Pick the i-th palette colour, cycling for large fields. */
export function paletteColour(i: number): string {
  return PALETTE[i % PALETTE.length];
}
