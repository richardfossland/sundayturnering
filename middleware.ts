import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { sharedCookieOptions } from "@/lib/supabase/cookies";

/**
 * Minimal middleware for the Sunday Account admin layer ONLY.
 *
 * The matcher (bottom) is scoped to `/admin/*` and `/auth/*` so NOTHING in the
 * anonymous play surface (`/`, `/hurtig`, `/ny`, `/board`, `/kontroll`, `/se`,
 * `/live`, `/tavle`, every `/api/*`) is gated or even runs this code. Anonymous
 * tournaments keep working with zero auth.
 *
 * On the admin/auth routes it:
 *   1. refreshes the `sb-*` session cookie against the AUTH (issuer) project,
 *   2. redirects unauthenticated visitors of `/admin/*` to `/admin/login`.
 * `/admin/login` and `/auth/callback` are reachable without a session (the
 * callback lands the OAuth/magic-link exchange before any cookie exists).
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUNDAY_AUTH_URL;
  const key = process.env.NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY;
  // If auth isn't configured (e.g. preview without SSO env), don't break the
  // app — just pass through. Admin route handlers still enforce requireAdmin().
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookieOptions: sharedCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet)
          request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  // `/auth/*` (the callback) and `/admin/login` are always reachable.
  const isOpen = path.startsWith("/auth") || path === "/admin/login";

  if (!user && path.startsWith("/admin") && !isOpen) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/admin/login";
    return NextResponse.redirect(redirect);
  }
  if (user && path === "/admin/login") {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/admin";
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  // Scoped to the admin layer ONLY — anonymous play never hits middleware.
  matcher: ["/admin/:path*", "/auth/:path*"],
};
