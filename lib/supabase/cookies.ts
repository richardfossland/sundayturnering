import type { CookieOptions } from "@supabase/ssr";

/**
 * Shared cookie options for every AUTH Supabase client (browser, server,
 * middleware) so the Sunday Account session cookie is written identically
 * everywhere.
 *
 * Cross-subdomain SSO (Sunday Account): when `NEXT_PUBLIC_COOKIE_DOMAIN` is set
 * (`.sundaysuite.app` in production), the `sb-*` session cookie is scoped to the
 * parent domain so every Sunday web app shares one login. Left unset in local
 * dev so cookies keep working on `localhost`.
 *
 * NOTE: this applies ONLY to the auth client (the Sunday Account issuer
 * project). The DATA client (`lib/supabase/client.ts` / `service.ts`) stays
 * session-less and must never touch these cookies.
 */
export function sharedCookieOptions(): CookieOptions {
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim();
  if (!domain) return {};
  return {
    domain,
    path: "/",
    sameSite: "lax",
    secure: true,
  };
}
