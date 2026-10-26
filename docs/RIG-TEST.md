# Rig test — what only Richard can verify

The pure logic + route seams (`npm test`, ~250 vitest), typecheck, lint and
production build are all green. The DB-touching + multi-device paths need a
real Supabase project and real devices. Walk these once provisioned
(`scripts/provision.mjs`):

## Setup
1. `npm run dev`, open `http://localhost:3000`.
2. Create a tournament via the wizard (`/ny`): pick **Liga + sluttspill**,
   **Enkelt resultat**, add 6 teams (bulk-paste works), parallel with 2 courts.
3. You land on the **Kontrollsenter** `/arrangor/[id]` with three codes
   (Dommerkode, Skjermkode, Arrangørkode) — note the **Arrangørkode**.

## Kontrollsenter + Storskjerm window (projector)
- [ ] «Vis på storskjerm» opens the Storskjerm in its **own window**; the
      Kontrollsenter stays in the original tab. Pressing it again brings the
      same window forward (no second Storskjerm).
- [ ] With pop-ups blocked: the page offers «Åpne storskjermen i ny fane» instead.
- [ ] Back and reload on the Kontrollsenter keep all three codes.
- [ ] The landing page lists the tournament under «Mine turneringer»; «Glem»
      removes it (and its codes) from this device only.
- [ ] Drag the board window to the projector, press **F** (or ⛶ in the ⋯
      menu) → fullscreen; F again leaves it.
- [ ] Leave the board idle for longer than the machine's screen-sleep time:
      the screen stays on (Chrome/Edge/Safari 16.4+).

## Storskjerm (projector)
- [ ] `/board/[id]` shows title, the **«Følg turneringen» QR only** (no
      Dommerkode), the lobby («Venter på start», «Slik blir du dommer»), then
      «Nå spiller» / «Neste kamp» and an empty table.
- [ ] Between two matches the «Nå spiller» panel shows «Neste kamp» (teams,
      time, court) instead of an empty frame.
- [ ] «Koder og lenker» shows the Dommerkode + QR and the Skjermkode on the
      organiser's machine. On another machine (raw `/board/[id]` URL) it asks for
      the Skjermkode once, then remembers it.
- [ ] Looks good at 3–5 m (large type, team colours, gold accent), and never
      scrolls on a landscape screen ≥ 900 px.

## Dommer (phone)
- [ ] «Jeg er dommer» on the front page, or scan the QR / open
      `/kontroll?code=…` → attach; the Storskjerm's device count (Presence)
      increments.
- [ ] Tap a scheduled match → enter a result → Storskjerm updates within ~1 s.
- [ ] «Jeg dømmer på …» filters the list by court; the choice persists across
      reloads.

## Referee credential (Dommerkode)
- [ ] Open `/se/[id]` («Følg turneringen») on a phone that never attached:
      `GET /api/tournament/[id]` in devtools contains **no** `control_code` /
      `board_code` (before 2026-09-22 it leaked the control code, so a follow
      link was enough to enter results). `POST /api/match/result` with a valid
      `matchId` but no/wrong `controlCode` returns 403 `feil_kontrollkode`.
- [ ] Open `/kontroll/[id]` directly (deep link) on a fresh device → the page
      asks for the six-digit Dommerkode before anything else; a code for a DIFFERENT
      tournament is refused («tilhører en annen turnering»).

## Running score (Storskjerm)
- [ ] Open a match on a phone (Enkelt resultat) and tap +/−: the Storskjerm's
      «Nå spiller» card shows the running score within ~1 s, and the result
      sheet shows «Stillingen vises live på storskjermen mens du taster». Close
      without saving → the score stays on the Storskjerm until the result is
      saved (the match is still live). Save → normal result flow.
- [ ] Sett-profile: the set line under the tally on the Storskjerm updates as
      sets are typed; a level set (24–24) counts for nobody until it is decided.

## Concurrency (two phones, same match)
- [ ] Phone A opens a match → Phone B sees "Redigeres av …" + "Ta over".
- [ ] Both submit different scores → the **second gets** "Resultatet ble endret
      av en annen enhet" and refetches (no silent overwrite). This is the §4
      gate; also covered headless by `scripts/smoke.mjs`.

## Scoring profiles
- [ ] A **Sett eller perioder** (volleyball, best-of-5) tournament: add-set UI,
      set diff feeds the table.
- [ ] A **Bare vinner** tournament: two big buttons, no draws.

## Playoff / Cup
- [ ] Finish the league → Kontrollsenter (the Arrangørkode is stored on the
      creating device) → «Start sluttspill» builds the bracket from the
      table (top-N).
- [ ] «Start sluttspill» with league matches still unplayed asks first
      («N kamper er ikke spilt ennå …»); after it, those league matches refuse
      new results («Seriespillet er over …») and no longer appear under
      «Neste kamper» on the courts, in «Neste» on the Storskjerm or on
      «Følg turneringen».
- [ ] Wrong Arrangørkode is rejected; a referee without it cannot start the playoff.
- [ ] Bracket fills in live on the Storskjerm; the final winner → champion screen.
- [ ] A pure **Cup** with 5 teams: byes go to the top seeds.
- [ ] **Level knockout score:** Enkeltkamp (`/hurtig`), enter 1–1 → «Hvem gikk
      videre?» appears (no 0–0 chip); saving without a pick is refused; pick a
      team → the tournament finishes, board/result page show «1–1 (str.)».
- [ ] **Rett et resultat after the next round:** with a semifinal and the final
      both played, correct the semifinal to the other winner → the panel says how
      many later matches will be reset and asks; confirm → the final goes back
      to «Avventer»/scheduled with the new finalist in its slot.
- [ ] Finish a tournament, then Kontrollsenter → «Gjenåpne turneringen» → the
      Storskjerm leaves the champion screen and results can be corrected.
- [ ] After «Avslutt turnering», a referee can no longer save a result
      («Turneringen er avsluttet»).
- [ ] «Forsink eller framskynd kamper»: the preview lists the affected matches
      in time order (earliest first).

## Reconnect
- [ ] Kill the Storskjerm tab mid-tournament, reopen `/board/[id]` → state restored.
- [ ] Drop wifi on a control device → it recovers on the poll backstop.
- [ ] **Frakoblet-banner:** with the Storskjerm open, turn wifi off → within a few
      seconds the banner «Frakoblet. Sist oppdatert …» appears and the last
      good state stays on screen. Turn wifi back on → the banner clears by
      itself, without reloading the page.
- [ ] **Utløpt timer lager ikke lyd:** start a short timer, let it expire, then
      reload the board → no buzzer on load (it only sounds when the timer
      expires live while watching).
- [ ] **Feilside gjenoppretter seg:** make the Storskjerm hit its error page (e.g.
      block the API in devtools, then unblock) → after ~5 s it recovers on its
      own, no manual reload.
- [ ] **Tidsavbrudd ≠ feil kode:** on a slow/throttled link ("Slow 3G" or
      blocked API) enter a correct Dommerkode → the message says
      «tidsavbrudd» / try again, NOT «feil kode».
- [ ] _(kommer)_ **For mange forsøk:** enter wrong codes repeatedly on the
      «Jeg er dommer» screen → «For mange forsøk» appears (and a correct code still
      works after the minute has passed).

## Load (one IP, 30 phones)
- [ ] Against a dev server: `node scripts/load.mjs http://localhost:3000` →
      zero 429s on correct-code attach/live traffic, exactly one 409 on a
      simultaneous double result submit. Restart the dev server between runs
      (rate-limit buckets live in process memory).

## Deploy verification
- [ ] `scripts/provision.mjs` → migrations applied, `.env.local` written.
- [ ] OpenNext build + deploy (docs/DEPLOY.md) → `turnering.sundaysuite.app`
      serves 200 with valid SSL.
