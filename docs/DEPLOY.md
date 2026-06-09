# Deploy — turnering.sundaysuite.app

SundayTurnering is its **own** deployment on the subdomain
`turnering.sundaysuite.app` (the `sundaysuite.app` zone is already on
Cloudflare, account `4a992e0fd6c83f2eaacf3f275b344c1b`). Same pipeline as its
sibling SundaySjakk (chess.sundaysuite.app): Next 16 SSR → a Cloudflare **Worker**
via `@opennextjs/cloudflare`.

## 1. Provision the dedicated Supabase project

Needs a Supabase Management token (`sbp_…`, Account → Access Tokens). Creates the
`sundayturnering` project in the **Sunday** org (Stockholm), applies both
migrations, and writes `.env.local`:

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx DB_PASSWORD='strong-password' node scripts/provision.mjs
# ⚠ Revoke the access token afterwards.
```

(Or create the project by hand in the dashboard, run the two files in
`supabase/migrations/` via the SQL editor, and copy URL + anon + service_role
keys into `.env.local` using `.env.example` as the template.)

## 2. Local rig test (recommended before deploy)

```bash
npm run check          # tsc + eslint + vitest (42 unit tests)
npm run dev            # http://localhost:3000
BASE=http://localhost:3000 node scripts/smoke.mjs   # full league + concurrency + cup byes
```

Then walk `docs/RIG-TEST.md` (two phones + a projector tab).

## 3. Build + deploy the Worker

```bash
# NEXT_PUBLIC_* are inlined at build time → .env.local must hold the real
# Supabase URL/anon key BEFORE building.
npx opennextjs-cloudflare build
npx opennextjs-cloudflare deploy            # = wrangler deploy

# service-role key is a RUNTIME secret (never inlined):
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# Custom domain: wrangler.jsonc `routes` already declares
# turnering.sundaysuite.app as a custom_domain; or attach in the dashboard
# (Workers & Pages → sundayturnering → Domains).
```

Env summary:
- **Build-time (inlined):** `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_BASE_URL=https://turnering.sundaysuite.app`
- **Runtime secret:** `SUPABASE_SERVICE_ROLE_KEY` (`wrangler secret put`)

> The in-memory rate-limiter (lib/server/http.ts) assumes a single instance.
> Cloudflare may run multiple isolates — fine for a single event; revisit
> (edge KV) only if abused at scale.

## Optional: organiser accounts via suite auth

`tournaments.organiser_id` is a ready seam for a real Supabase-Auth organiser
account (reopen a tournament later from the suite account) — wire to this
project's own Supabase Auth if/when desired. v1 uses anonymous code-pairing.
