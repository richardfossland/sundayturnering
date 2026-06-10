// Built-in team emblems — a curated set of crest-style badges (a coloured,
// gradient rounded square + a bold white icon). Auto-assigned at random, without
// duplicates within a tournament, when teams are generated. Stored as data-URI
// SVGs in team.logo_url, so they render anywhere a logo does (wizard, board,
// standings, champion) and survive the create payload + DB with no schema change.

// Each entry is the inner markup of a 24×24 icon (white fill unless it sets its
// own stroke/fill). Kept simple + geometric so they read at 26px and scale to
// the projector.
const ICONS: string[] = [
  // star
  `<polygon points="12,2 14.6,9.1 22,9.3 16.1,13.9 18.1,21 12,16.9 5.9,21 7.9,13.9 2,9.3 9.4,9.1"/>`,
  // lightning
  `<polygon points="13,2 5,13 11,13 10,22 19,9 12,9"/>`,
  // shield
  `<path d="M12 2l8 3v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11V5z"/>`,
  // crown
  `<path d="M4 9l3.5 3 4.5-7 4.5 7L20 9l-2 10H6z"/>`,
  // flame
  `<path d="M12 2c4 5 6 7 6 10a6 6 0 1 1-12 0c0-2 1-4 3-6 0 2 1 3 2 3 0-3 .5-5 1-7z"/>`,
  // hexagon
  `<polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/>`,
  // diamond
  `<polygon points="12,2 22,12 12,22 2,12"/>`,
  // ring
  `<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="3.4"/>`,
  // mountain
  `<polygon points="12,3 22,21 2,21"/>`,
  // droplet
  `<path d="M12 2c5 6 7 9 7 12a7 7 0 1 1-14 0c0-3 2-6 7-12z"/>`,
  // heart
  `<path d="M12 21C5.5 15.3 3.5 11.4 3.5 8.2A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8.5 2.2c0 3.2-2 7.1-8.5 12.8z"/>`,
  // cross / plus
  `<path d="M9.5 3h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>`,
  // sun
  `<g><circle cx="12" cy="12" r="4.6"/><g stroke="#fff" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1.5" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22.5" y2="12"/><line x1="4.3" y1="4.3" x2="6" y2="6"/><line x1="18" y1="18" x2="19.7" y2="19.7"/><line x1="19.7" y1="4.3" x2="18" y2="6"/><line x1="6" y1="18" x2="4.3" y2="19.7"/></g></g>`,
  // crescent
  `<path d="M16.5 3a9 9 0 1 0 3.5 14.2A7 7 0 0 1 16.5 3z"/>`,
  // pentagon
  `<polygon points="12,2 22,9.5 18.2,21 5.8,21 2,9.5"/>`,
  // square (rounded, tilted)
  `<rect x="5.5" y="5.5" width="13" height="13" rx="2.5" transform="rotate(45 12 12)"/>`,
  // chevron
  `<polygon points="12,3 22,13 17,13 12,8 7,13 2,13"/>`,
  // target
  `<g fill="none" stroke="#fff" stroke-width="2.6"><circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.4"/></g>`,
  // leaf
  `<path d="M5 20c0-9 7-15 15-15 0 9-6 15-15 15z"/>`,
  // octagon
  `<polygon points="8,3 16,3 21,8 21,16 16,21 8,21 3,16 3,8"/>`,
  // four-point star
  `<polygon points="12,2 14,10 22,12 14,14 12,22 10,14 2,12 10,10"/>`,
  // trophy
  `<g><path d="M7 5h10v3a5 5 0 0 1-10 0z"/><rect x="10.5" y="11.5" width="3" height="4"/><rect x="8" y="16.5" width="8" height="2.6" rx="1"/></g>`,
  // ring + dot
  `<g><circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="2.6"/><circle cx="12" cy="12" r="3"/></g>`,
];

export const EMBLEM_COUNT = ICONS.length;

function badge(i: number): string {
  const h = Math.round((i * 360) / EMBLEM_COUNT);
  const icon = ICONS[i % EMBLEM_COUNT];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<defs>` +
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="hsl(${h} 68% 57%)"/>` +
    `<stop offset="1" stop-color="hsl(${h} 60% 40%)"/>` +
    `</linearGradient>` +
    `<radialGradient id="s" cx="50%" cy="2%" r="85%">` +
    `<stop offset="0" stop-color="rgba(255,255,255,.4)"/>` +
    `<stop offset="1" stop-color="rgba(255,255,255,0)"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="64" height="64" rx="16" fill="url(#g)"/>` +
    `<rect width="64" height="64" rx="16" fill="url(#s)"/>` +
    `<g transform="translate(17 17) scale(1.25)" fill="#fff">${icon}</g>` +
    `</svg>`
  );
}

/** data-URI for emblem i (stable). */
export function emblemDataUri(i: number): string {
  return "data:image/svg+xml," + encodeURIComponent(badge(i));
}

/** All emblem data-URIs in a fresh random order (Fisher–Yates). */
export function allEmblemsShuffled(): string[] {
  const idx = Array.from({ length: EMBLEM_COUNT }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.map(emblemDataUri);
}

/** True if a logo_url is one of our built-in emblems (vs an uploaded file). */
export function isEmblem(url: string | null | undefined): boolean {
  return !!url && url.startsWith("data:image/svg+xml");
}
