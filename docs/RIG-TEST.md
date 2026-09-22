# Rig test — what only Richard can verify

The pure logic + route seams (`npm test`, ~250 vitest), typecheck, lint and
production build are all green. The DB-touching + multi-device paths need a
real Supabase project and real devices. Walk these once provisioned
(`scripts/provision.mjs`):

## Setup
1. `npm run dev`, open `http://localhost:3000`.
2. Create a tournament via the wizard (`/ny`): pick **Liga + sluttspill**,
   **Enkel score**, add 6 teams (bulk-paste works), parallel with 2 courts.
3. You land on the **organiser page** `/arrangor/[id]` with three codes —
   note the **organiser code**.

## Organiser page + board window (projector)
- [ ] «Åpne tavla på storskjerm» opens the board in its **own window**; the
      organiser page stays in the original tab. Pressing it again brings the
      same window forward (no second board).
- [ ] With pop-ups blocked: the page offers «Åpne tavla i ny fane» instead.
- [ ] Back and reload on the organiser page keep all three codes.
- [ ] The landing page lists the tournament under «Mine turneringer»; «Glem»
      removes it (and its codes) from this device only.
- [ ] Drag the board window to the projector, press **F** (or ⛶ in the ⋯
      menu) → fullscreen; F again leaves it.
- [ ] Leave the board idle for longer than the machine's screen-sleep time:
      the screen stays on (Chrome/Edge/Safari 16.4+).

## Board (projector)
- [ ] `/board/[id]` shows title, the **follow QR only** (no control code),
      "Nå spiller" (lobby), "Neste", empty standings.
- [ ] ⋯ → ⚿ shows the control code + QR and the board code on the organiser's
      machine. On another machine (raw `/board/[id]` URL) ⚿ asks for the board
      code once, then remembers it.
- [ ] Looks good at 3–5 m (large type, team colours, gold accent).

## Control (phone)
- [ ] Scan the QR / open `/kontroll?code=…` → attach; the board's device count
      (Presence) increments.
- [ ] Tap a scheduled match → enter a result → board updates within ~1 s.
- [ ] Court chips filter the list; pinning a court persists across reloads.

## Referee credential (control code)
- [ ] Open `/se/[id]` (public follow link) on a phone that never attached:
      `GET /api/tournament/[id]` in devtools contains **no** `control_code` /
      `board_code` (before 2026-09-22 it leaked the control code, so a follow
      link was enough to enter results). `POST /api/match/result` with a valid
      `matchId` but no/wrong `controlCode` returns 403 `feil_kontrollkode`.
- [ ] Open `/kontroll/[id]` directly (deep link) on a fresh device → the page
      asks for the six-digit code before anything else; a code for a DIFFERENT
      tournament is refused («tilhører en annen turnering»).

## Live score (board)
- [ ] Open a match on a phone (Enkel score) and tap +/−: the board's «Nå
      spiller» card shows the running score within ~1 s, and the modal shows a
      pulsing «Stillingen vises live på tavla». Close without saving → the
      score stays on the board until the result is saved (the match is still
      live). Save → normal result flow.
- [ ] Sett-profile: the set line under the tally on the board updates as sets
      are typed; a level set (24–24) counts for nobody until it is decided.

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
- [ ] Finish the league → Organiser panel (the code is pre-filled on the
      creating device) → "Start sluttspill" builds the bracket from the
      standings (top-N).
- [ ] "Start sluttspill" with league matches still unplayed asks first
      («N kamper er ikke spilt ennå …»); after it, those league matches refuse
      new results («Serien er over»).
- [ ] Wrong organiser code is rejected; a referee without it cannot advance.
- [ ] Bracket fills in live on the board; the final winner → champion screen.
- [ ] A pure **Cup** with 5 teams: byes go to the top seeds.
- [ ] **Level knockout score:** Hurtigkamp (`/hurtig`), enter 1–1 → «Hvem gikk
      videre?» appears (no 0–0 chip); saving without a pick is refused; pick a
      team → the tournament finishes, board/result page show «1–1 (str.)».
- [ ] **Override after the next round:** with a semifinal and the final both
      played, override the semifinal to the other winner → the panel says how
      many later matches will be reset and asks; confirm → the final goes back
      to «Avventer»/scheduled with the new finalist in its slot.
- [ ] Finish a tournament, then Organiser panel → «Gjenåpne turneringen» → the
      board leaves the champion screen and results can be corrected.
- [ ] After «Avslutt», a referee can no longer save a result («Turneringen er
      avsluttet»).

## Reconnect
- [ ] Kill the board tab mid-tournament, reopen `/board/[id]` → state restored.
- [ ] Drop wifi on a control device → it recovers on the poll backstop.

## Deploy verification
- [ ] `scripts/provision.mjs` → migrations applied, `.env.local` written.
- [ ] OpenNext build + deploy (docs/DEPLOY.md) → `turnering.sundaysuite.app`
      serves 200 with valid SSL.
