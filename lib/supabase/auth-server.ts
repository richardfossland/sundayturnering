import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { sharedCookieOptions } from "./cookies";

/**
 * AUTH client — bound to the SUNDAY ACCOUNT ISSUER Supabase project (NOT the
 * turnering data project). Used only to resolve the signed-in admin from the
 * `sb-*` session cookie. Authorization happens in `lib/server/auth.ts`
 * (`isAdminEmail`); identity here just answers "who is logged in".
 *
 * This is deliberately separate from the DATA clients (`service.ts` /
 * `client.ts`), which stay session-less so they never fight over cookies. The
 * issuer URL/key live under their own env names so the data project's
 * `NEXT_PUBLIC_SUPABASE_*` vars are untouched.
 */
export async function createAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUNDAY_AUTH_URL;
  const key = process.env.NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Sunday Account auth env missing: set NEXT_PUBLIC_SUNDAY_AUTH_URL and NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY",
    );
  }
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookieOptions: sharedCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // In Server Components cookie writes throw; the middleware refreshes the
        // session, so swallowing here is safe.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // no-op in RSC render context
        }
      },
    },
  });
}
