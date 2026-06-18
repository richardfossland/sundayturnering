"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser AUTH client — points at the SUNDAY ACCOUNT ISSUER project, NOT the
 * turnering data project. Used only on the admin login page to start a magic
 * link / Google OAuth flow. The session cookie it owns is the `sb-*` cookie
 * scoped to `.sundaysuite.app` (see `cookies.ts`).
 *
 * The DATA browser client (`lib/supabase/client.ts`) is unchanged and stays
 * session-less (Realtime/presence only) so the two clients never collide.
 */
export function createAuthBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_URL!,
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY!,
  );
}
