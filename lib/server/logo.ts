// Which team logos the create route will store. A logo_url is rendered on
// every board, control and spectator screen and re-sent on every state poll,
// so it must not be an arbitrary third-party URL (tracking pixel on every
// spectator's phone) or an unbounded data: URI.
//
// Accepted: a built-in emblem (an inline SVG data-URI — inert in <img>, which
// never runs script or loads external resources) within a size cap, or a file
// uploaded to this project's own public 'team-logos' bucket.

const MAX_DATA_URI = 8_000;

export function sanitiseLogoUrl(
  url: unknown,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  if (typeof url !== "string" || !url) return null;
  if (url.startsWith("data:image/svg+xml,"))
    return url.length <= MAX_DATA_URI ? url : null;
  if (supabaseUrl) {
    const prefix = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/team-logos/`;
    // Exactly one path segment after the bucket: the uploader's random name.
    if (url.startsWith(prefix) && /^[\w.-]+$/.test(url.slice(prefix.length))) return url;
  }
  return null;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Team colours end up in inline styles; accept only #rrggbb. */
export function sanitiseColour(c: unknown): string {
  return typeof c === "string" && HEX.test(c) ? c : "#888888";
}
