import { NextResponse } from "next/server";

import { createAuthClient } from "@/lib/supabase/auth-server";

// OAuth/magic-link landing for the Sunday Account login. Exchange the code for a
// session cookie (scoped to .sundaysuite.app via sharedCookieOptions), then send
// the admin to the dashboard. Whitelisted in middleware (no session yet here).
//
// Hardened: `next` is only honoured when it is a same-origin absolute PATH
// (starts with "/" but not "//"), so a crafted `?next=https://evil` can't turn
// the callback into an open redirect.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/admin";

  if (code) {
    try {
      const supabase = await createAuthClient();
      await supabase.auth.exchangeCodeForSession(code);
    } catch {
      // Exchange failed (expired/replayed link) → bounce back to login.
      return NextResponse.redirect(`${origin}/admin/login?error=auth`);
    }
  }
  return NextResponse.redirect(`${origin}${next}`);
}
