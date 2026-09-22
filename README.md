# SundayTurnering

Big-screen, sport-agnostic tournament manager for schools and events. One
device runs a **board** on a projector; phones/tablets enter results as
**control** devices. Part of the Sunday Suite — sibling to
[SundaySjakk](../sundaysjakk). Target: `turnering.sundaysuite.app`.

- **Formats:** Liga (round-robin), Liga + sluttspill (round-robin → top-N
  single-elim), Gruppespill (groups → knockout from each group's top-K),
  Cup (seeded single-elim), optional bronze final, and a one-tap 1v1
  Hurtigkamp (`/hurtig`).
- **Scoring profiles:** Enkel score · Sett/perioder · Bare vinner. A level
  score in a knockout match needs a `decider` (penalties / extra time),
  shown as «1–1 (str.)».
- **Courts:** sequential or parallel across named courts.
- **Pairing:** 6-digit control code (referees) + word board code (reopen the
  board) + word **organiser code** (gates advance/override/finish/reopen —
  referees can only enter results).
- **Organiser page** `/arrangor/[id]`: after creation the codes are stored on
  the creating device («Mine turneringer» on the landing page), so Back or a
  reload never loses them. «Åpne tavla» opens the board in its own window
  (fullscreen with F / ⛶, screen kept awake).

## Security model
- The anonymous state endpoint (`GET /api/tournament/[id]`, read by the
  `/se` and `/live` follow links) carries **no codes**. Codes travel only
  from `/api/attach` to a device that has just proved one.
- Every referee write route requires the control code; organiser routes the
  organiser code (or a signed-in owner) and are rate-limited per IP.
- The board shows only the follow QR; the control code is behind ⚿.

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
  bracket build + winner advancement, scoring profiles, downstream reset for
  knockout overrides — unit-tested (`npm test`, ~250 vitest incl. route
  seams), no UI/DB coupling.

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
