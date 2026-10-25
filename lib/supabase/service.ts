import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const DB_TIMEOUT_MS = 12_000;

/** fetch with a 12 s ceiling, combined with any signal the caller passed. */
export function boundedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const timeout = AbortSignal.timeout(DB_TIMEOUT_MS);
  return fetch(input, {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
}

/** Service-role Supabase client — SERVER ONLY. Bypasses RLS, so it must never
 * be imported into client code (the `server-only` guard enforces this at build
 * time). Every state-changing API route uses this. */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  // Default every table query + RPC to the dedicated `turnering` schema (this
  // project is shared with SundayChess, which owns `public`). Storage is not
  // schema-scoped, so logo uploads still work.
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "turnering" },
    // Bound every PostgREST/storage call: a stalled Supabase connection would
    // otherwise hold the Worker request open until the platform kills it.
    // (/api/health relies on this 12 s bound.)
    global: { fetch: boundedFetch },
  });
}
