# Designaudit og oppussingsplan — SundayTurnering (2026-10-26)

Grunnlag: gjennomgang av alle 14 sider på `localhost:3110` (main `601eb16`) som ny bruker,
på desktop (1280×820) og telefon (375×812), i mørkt og lyst tema. En ZZTEST-turnering
(liga + sluttspill, 8 lag, 2 baner, tidsplan) ble opprettet, brukt og slettet.

Alvorlighet: **A** = feil som stopper eller villeder · **B** = gjør det vanskelig for nye brukere · **C** = finpuss.

---

## 1. Feil funnet (A)

| # | Hvor | Hva skjer | Årsak |
|---|------|-----------|-------|
| A1 | Alle tallfelt (veiviser, arrangørpanel) | Tøm feltet og skriv «3» → det blir **12 baner**. Poeng: tøm og skriv «2» → «02». Feltet hopper til min-verdi ved hvert tastetrykk. | `onChange` klemmer verdien til min/maks for hvert tegn i stedet for ved forlatt felt. |
| A2 | Tavla, /live, dommertelefon | Knappene «Baner», «Tabell» og «1 tilkoblet» er **usynlige** (hvit tekst på hvit knapp) i mørkt tema. | `.pill` brukt på `<button>` mangler `background`, så nettleserens standard grå/hvit vises. |
| A3 | /resultat | Viser «VINNER Lag 1» og medaljeplasser etter én spilt kamp. | Siden skiller ikke mellom pågående og ferdig turnering. |
| A4 | Forsiden, lyst tema | Overskriften «Turneringen din,» og «Mine turneringer» er nesten usynlige (lys grå på krem). | Mørk-tema-farge brukt uten lys-variant. |

## 2. Navigasjon og forståelse (B)

- **Ingen forklarer rollene.** Siden har tre brukere (arrangør, dommer, publikum), men forsiden sier bare «Bli med (kontroll)» og «Åpne tavle». En ny bruker vet ikke hvilken knapp som er sin.
- **Tre koder uten forklaring.** Arrangørsiden viser kontrollkode, tavlekode og arrangørkode side om side. Bare én kort tekst sier noe om hvem som skal ha hva.
- **Arrangørverktøy er gjemt.** «Start sluttspill», «Avslutt turnering», «Overstyr», «Kall opp» og «Skyv tidsplanen» ligger bak «⚙︎ Arrangør» *nederst* på dommersiden, under alle 27 kampene. Arrangørsiden lenker dit som «Registrer resultater og arrangørpanel».
- **Ingen vei tilbake.** Veiviseren, /kontroll, /tavle og /hurtig har ingen lenke til forsiden eller arrangørsiden.
- **Ingen «hva nå?» etter opprettelse.** Arrangørsiden er en knappeliste, ikke en sjekkliste (1. åpne storskjerm, 2. gi dommerne koden, 3. start første kamp).
- **To publikumssider.** /live (tavle-kopi) og /se («Heiagjeng» med reaksjoner) overlapper. /live på telefon viser en QR-kode som peker til seg selv, og knappen «Trykk for lyd».
- **Steg-telleren endrer seg.** Veiviseren sier «Steg 1 av 6» og blir «Steg 3 av 7» etter at man velger format med sluttspill.

## 3. Veiviseren (/ny)

- Smalt kort (~560 px) midt på en stor skjerm. Liten tekst, mye tomrom rundt, trangt inni.
- Stegene har ingen navn og kan ikke klikkes. Man ser ikke hvor man er, eller hva som kommer.
- Steg 1: «Annet» står valgt selv om feltet «Idrett» er tomt.
- Steg 2: seks formater uten hjelp til å velge («Usikker? Velg Liga for 4–8 lag»). «Swiss» og «N runder» er sjargong.
- Steg 3: poengfeltene (3 / 1 / 0) står uten etikett ved hvert felt, bare samlet over. Standard blå sjekkboks bryter med designet.
- Steg 4 (Lag): fire måter å lage lag på samtidig (antall + «Opprett», «Legg til lag», «Trekk lag», «Lim inn»). Knappen «Opprett» forveksles med «Opprett turnering». Feltet viser «8» selv om 0 lag finnes. Laglisten scroller i egen boks inne i siden. Fargeruta og logo-ikonet er ikke forklart.
- Steg 5: 12 banenavn-felt blåses ut av feil A1. «Pause mellom kamper» og «Minste hvile per lag» er vanskelige å skille.
- Oppsummering: mangler «ferdig ca. kl.» når tidsplan er på, og man kan ikke hoppe tilbake til et steg for å rette.

## 4. Storskjermen (/board)

- Siden er **høyere enn skjermen** (885 px på 820 px vindu). På projektor kan ingen scrolle, så kamplisten kuttes.
- Tekst og tabell er for små for lesing på avstand (tabellrader ~13 px ved 1280 px bredde).
- Tabellforkortelser `K S U T ± P` er uforklart.
- «Nå spiller» står to ganger (fane + overskrift).
- I lobbyen («Venter på start») mangler stor, tydelig info om hvordan man blir dommer eller følger med. Bare en liten «Følg live»-QR.

## 5. Dommertelefonen (/kontroll/[id])

- Den faste toppen tar ~40 % av skjermhøyden (tittel, piller, statusfaner, banefilter, kamp-timer, «din neste kamp») og er halvgjennomsiktig, så kampkort skinner gjennom.
- Kamp-timer finnes to steder (topp og arrangørpanel) med ulike knapper («5m» vs «5 min»).
- Resultatvindu: ordet «mot» overlapper +/−-knappene, høyre «+» treffer kanten, og man kan ikke trykke på tallet for å skrive det inn. «Nullstill» står blant resultatforslagene.
- Ingen tydelig bekreftelse etter «Lagre» (kortet bare forsvinner).
- Arrangørpanelets banekort lister *alle* kommende kamper (14 per bane), og «Skyv tidsplanen» lister alle 27 i forhåndsvisningen. Lange vegger av tekst.

## 6. Øvrige sider

- **Resultat/diplom:** se A3. Medalje-emoji, knapper med emoji.
- **Utskrift:** standard sjekkbokser, emoji i knapp, «← Tilbake» liten og grå.
- **Hurtigkamp:** «⚡» i tittel, «Lag 1 / Lag 2» som plassholdere (ser ut som verdier).
- **/tavle og /kontroll:** ingen forklaring på *hvor* koden finnes, ingen vei tilbake.

## 7. Gjennomgående

- **184 emoji/symboler** i UI-koden (🖥 📱 📣 🖨️ 🏆 💾 🎲 ⚡ ⚙︎ ★ 🏅 🔈 …) i 16 filer.
- **~80 inline `style={{…}}`** i veiviser og kontrollsider. Avstander og bredder er satt for hånd, derfor varierer luften.
- Ingen felles avstandsskala eller typografiskala. Etiketter er 0.78–0.9 rem og varierer.
- Next.js-utviklerknappen (N) dekker temabryteren nede til venstre (bare i dev, men skjuler bryteren under testing).

---

## Eierbeslutninger (2026-10-26)

1. **Navn byttes** etter ordlisten under. Gamle lenker og koder virker fortsatt.
2. **Arrangørverktøyene samles på arrangørsiden (Kontrollsenter).** Dommertelefonen får dem i en egen fane når arrangørkoden er tastet.
3. **/live og /se slås sammen** til «Følg turneringen». Gamle lenker videresendes.
4. **Uttrykket beholdes** (gull/blekk, samme skrifter). Ryddes med avstandsskala, større tekst og ikoner i stedet for emoji. Ingen designskisse først.

## 8. Ordliste — nye navn

| I dag | Forslag | Hvorfor |
|-------|---------|---------|
| Tavle / «Åpne tavle» | **Storskjerm** / «Vis på storskjerm» | Beskriver hva det er |
| Tavlekode | **Skjermkode** | Følger navnet over |
| Kontrollkode | **Dommerkode** | Sier hvem den er for |
| «Bli med (kontroll)» | **«Jeg er dommer»** | Rollebasert |
| Hurtigkamp (1v1) | **Enkeltkamp** | «1v1» er sjargong |
| Swiss | **Sveitsisk system** | Norsk, med forklaring |
| Dobbel utslag | **Dobbel utslag (to liv)** | Forklarer i navnet |
| Kamp-timer | **Nedtelling** | Hva den gjør |
| Skyv tidsplanen | **Forsink eller framskynd kamper** | Hva den gjør |
| Spesialresultat | **Walkover, avbrutt eller diskvalifisert** | Konkret |
| Fest til bane | **Jeg dømmer på …** | Rollebasert |
| Følg live + Heiagjeng | **Følg turneringen** (én side) | Én publikumsside |
| Status «Serie» | **Seriespill pågår** | Lesbart |
| K S U T ± P | Kolonnetittel + forklaring under tabellen | Uforklart i dag |
| Arrangørside | **Kontrollsenter** (arrangør) | Samler alt arrangøren gjør |

---

## 9. Plan — runde i 8 PR-er

Rekkefølge: fundament først, siden alt annet bygger på det. Hver PR verifiseres i nettleser
(desktop + telefon, begge tema) før neste. Utføres som før: én Sonnet-agent per PR,
sekvensielt, og én Opus-gjennomgang til slutt.

**D0 — Fundament (designsystem)**
- Felles avstandsskala (4/8/12/16/24/32/48) og typografiskala som CSS-tokens. Bredere innholdsbredder (veiviser 720 px, arrangør 960 px).
- `NumberField`: lokal tekst-state, klemmer først når feltet forlates eller ved Enter, +/−-knapper, `inputMode="numeric"`, markerer innholdet ved fokus, viser «Maks 12» i stedet for å hoppe. Erstatter alle 8 tallfelt. Enhetstester for skrive-/tøm-/lim-inn-tilfellene.
- Retter `.pill`-knapper (A2), egen avkrysningsboks/bryter, egne valgknapper.
- Ikonsett: et lite sett inline-SVG (Lucide, ISC-lisens) i stedet for emoji. Fjerner alle 184 emoji/symboler.
- Lyst tema: kontrastsjekk av alle tokens mot WCAG AA (A4).

**D1 — Forside og navigasjon**
- Forside med tre tydelige roller: «Jeg arrangerer», «Jeg er dommer», «Jeg vil følge med». Hver med én setning forklaring. Enkeltkamp og storskjerm som sekundære valg.
- Felles toppfelt med logo/hjem på alle undersider. «Tilbake» der det gir mening.
- /tavle og /kontroll forklarer hvor koden står.

**D2 — Veiviseren**
- Bredere oppsett. Navngitte steg som kan klikkes for å gå tilbake. Fast antall steg (sluttspill-steget vises som «hoppes over» når det ikke trengs).
- Formatvalg med anbefaling og «Hva passer for meg?»-forklaring.
- Lag-steget: én primærmåte (skriv antall eller lim inn navn), «Trekk lag fra deltakerliste» som egen fane. Ingen indre scrollboks. Forklarte farge-/logovalg.
- Tidsplan med beregnet sluttid. Oppsummering med «Endre» per linje.

**D3 — Kontrollsenter (arrangørsiden)**
- Sjekkliste «Kom i gang»: 1. Vis på storskjerm, 2. Gi dommerne dommerkoden, 3. Start første kamp.
- Kodene forklart per rolle («Gi til dommere», «Bare for deg»).
- Arrangørverktøyene flyttes hit (sluttspill, avslutt, kall opp, forsink, overstyr) i stedet for å ligge gjemt nederst hos dommeren.

**D4 — Dommertelefonen**
- Kompakt topp (tittel + statusfaner). Banevalg og nedtelling sammenleggbare.
- Resultatvindu: rettet layout, trykk på tallet for å skrive, tydelig «Lagret»-bekreftelse.
- Arrangørpanelet på telefon får egen fane i stedet for bunnen av listen. Bane- og forsink-lister viser 3 neste + «Vis alle».

**D5 — Storskjermen**
- Passer alltid i én skjermhøyde (ingen scroll), skalerer med skjermstørrelse (clamp/vh-basert typografi).
- Større tekst, forklaring av kolonner, én «Nå spiller».
- Lobby: stor «Slik blir du dommer» + «Følg på mobilen» med QR.

**D6 — Publikum, resultat, utskrift, enkeltkamp**
- /live og /se slås sammen til «Følg turneringen». Reaksjoner med ikoner, ikke emoji. /live-adressen videresendes, så gamle QR-koder virker.
- Resultatside: «Foreløpig stilling» til turneringen er avsluttet (A3).
- Utskrift og enkeltkamp får nytt designsystem og ny tekst.

**D7 — Tekstvask og verifisering**
- Ordlisten over brukes konsekvent i alle tekster (`lib/locale/no.ts`) og i docs.
- Playwright-skjermbildetest: alle sider × 2 tema × 3 bredder (telefon/nettbrett/desktop) + en full ny-bruker-flyt. Leveres som rapport med før/etter-bilder.

**Ikke med:** endringer i turneringslogikk, database eller API, bortsett fra videresending fra /live.
Deploy skjer bare etter din godkjenning, som før.

**Avhengighet:** PR #70 (tidssone + baner) endrer veiviseren. Den bør merges før D0, så designrunden bygger på den.
