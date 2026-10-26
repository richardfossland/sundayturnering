# SundayTurnering

Big-screen, sport-agnostic tournament manager for schools and events. One
device runs the **Storskjerm** (the board) on a projector; phones/tablets
enter results as **dommer** (referee) devices. Part of the SundaySuite — sibling to
[SundaySjakk](../sundaysjakk). Target: `turnering.sundaysuite.app`.

- **Formats:** Liga (round-robin), Liga + sluttspill (round-robin → top-N
  single-elim), Gruppespill (groups → knockout from each group's top-K),
  Cup (seeded single-elim), Sveitsisk system (Swiss), Dobbel utslag (to liv),
  optional bronze final, and a one-tap 1v1 Enkeltkamp (`/hurtig`).
- **Scoring profiles:** Enkelt resultat · Sett eller perioder · Bare vinner. A level
  score in a knockout match needs a `decider` (penalties / extra time),
  shown as «1–1 (str.)».
- **Courts:** sequential or parallel across named courts.
- **Codes:** 6-digit **Dommerkode** (referees; `control_code` in code and API) +
  word **Skjermkode** (reopen the Storskjerm; `board_code`) + word
  **Arrangørkode** (gates start playoff / correct result / finish / reopen —
  referees can only enter results).
- **Kontrollsenter** `/arrangor/[id]`: the organiser's page, with a «Kom i
  gang» checklist, the three codes explained per role and all organiser tools
  (Baner nå, Forsink eller framskynd kamper, Nedtelling, Start sluttspill,
  Rett et resultat, Avslutt turnering). After creation the codes are stored on
  the creating device («Mine turneringer» on the landing page), so Back or a
  reload never loses them. «Vis på storskjerm» opens the Storskjerm in its own
  window (fullscreen with F, screen kept awake).
- **Følg turneringen** `/se/[id]`: the one public phone page (`/live/[id]`
  redirects here, so old QR codes still work).

## Security model
- The anonymous state endpoint (`GET /api/tournament/[id]`, read by the
  «Følg turneringen» page) carries **no codes**. Codes travel only
  from `/api/attach` to a device that has just proved one.
- Every referee write route requires the Dommerkode; organiser routes the
  Arrangørkode (or a signed-in owner) and are rate-limited per IP.
- The Storskjerm shows only the «Følg turneringen» QR; the Dommerkode is
  behind «Koder og lenker».

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
# classroom load test (30 phones, one IP; dev server only, never in CI):
node scripts/load.mjs http://localhost:3000
```

See `docs/DEPLOY.md` and `docs/RIG-TEST.md`.
