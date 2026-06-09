# SundayTurnering

Kahoot-style, sport-agnostic tournament manager for schools and events. One
device runs a **board** on a projector; phones/tablets enter results as
**control** devices. Part of the Sunday Suite — sibling to
[SundaySjakk](../sundaysjakk). Target: `turnering.sundaysuite.app`.

- **Formats:** Liga (round-robin), Liga + sluttspill (round-robin → top-N
  single-elim), Cup (seeded single-elim).
- **Scoring profiles:** Enkel score · Sett/perioder · Bare vinner.
- **Courts:** sequential or parallel across named courts.
- **Pairing:** 6-digit control code (referees) + word board code (reopen the
  board) + word **organiser code** (gates advance/override/finish — referees
  can only enter results).

## Stack
Next.js 16 (App Router) · TypeScript · Supabase (Postgres + Realtime
Broadcast/Presence + Storage) · plain-CSS suite tokens (gold/ink/paper,
Playfair + Hanken). Deployed as a Cloudflare Worker via OpenNext.

## Architecture
- **Authoritative state in Postgres.** RLS denies anon/authenticated all table
  access; the anon key is used **only** for Realtime. Every read/write goes
  through server Route Handlers using the service role.
- **Concurrency (§4):** result submit is an atomic Postgres RPC
  (`submit_match_result`) with a row lock + `result_version` compare-and-swap —
  two phones can't both commit; the loser is told to refetch. Plus a soft lock.
- **Pure logic** (`lib/tournament/*`): round-robin, standings (tiebreaks),
  bracket build + winner advancement, scoring profiles — fully unit-tested
  (42 vitest), no UI/DB coupling.

## Develop
```bash
npm install
npm run check        # tsc + eslint + vitest
npm run dev
# provision a dedicated Supabase project + apply migrations:
SUPABASE_ACCESS_TOKEN=sbp_… DB_PASSWORD=… node scripts/provision.mjs
BASE=http://localhost:3000 node scripts/smoke.mjs
```

See `docs/DEPLOY.md` and `docs/RIG-TEST.md`.
