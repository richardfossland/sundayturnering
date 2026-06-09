# Rig test — what only Richard can verify

The pure logic (42 vitest), typecheck, lint and production build are all green.
The DB-touching + multi-device paths need a real Supabase project and real
devices. Walk these once provisioned (`scripts/provision.mjs`):

## Setup
1. `npm run dev`, open `http://localhost:3000`.
2. Create a tournament via the wizard (`/ny`): pick **Liga + sluttspill**,
   **Enkel score**, add 6 teams (bulk-paste works), parallel with 2 courts.
3. The created screen shows three codes — note the **organiser code**.

## Board (projector)
- [ ] `/board/[id]` shows title, control code + QR, "Nå spiller" (lobby),
      "Neste", empty standings.
- [ ] Looks good at 3–5 m (large type, team colours, gold accent).

## Control (phone)
- [ ] Scan the QR / open `/kontroll?code=…` → attach; the board's device count
      (Presence) increments.
- [ ] Tap a scheduled match → enter a result → board updates within ~1 s.
- [ ] Court chips filter the list; pinning a court persists across reloads.

## Concurrency (two phones, same match)
- [ ] Phone A opens a match → Phone B sees "Redigeres av …" + "Ta over".
- [ ] Both submit different scores → the **second gets** "Resultatet ble endret
      av en annen enhet" and refetches (no silent overwrite). This is the §4
      gate; also covered headless by `scripts/smoke.mjs`.

## Scoring profiles
- [ ] A **Sett** (volleyball, best-of-5) tournament: add-set UI, set diff feeds
      the table.
- [ ] A **Bare vinner** tournament: two big buttons, no draws.

## Playoff / Cup
- [ ] Finish the league → Organiser panel → enter organiser code →
      "Start sluttspill" builds the bracket from the standings (top-N).
- [ ] Wrong organiser code is rejected; a referee without it cannot advance.
- [ ] Bracket fills in live on the board; the final winner → champion screen.
- [ ] A pure **Cup** with 5 teams: byes go to the top seeds.

## Reconnect
- [ ] Kill the board tab mid-tournament, reopen `/board/[id]` → state restored.
- [ ] Drop wifi on a control device → it recovers on the poll backstop.

## Deploy verification
- [ ] `scripts/provision.mjs` → migrations applied, `.env.local` written.
- [ ] OpenNext build + deploy (docs/DEPLOY.md) → `turnering.sundaysuite.app`
      serves 200 with valid SSL.
