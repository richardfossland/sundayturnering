# Logikk-audit — SundayTurnering (2026-10-26)

Grunnlag: main `124cc69` (rett etter designrunden). Tre parallelle gjennomganger:
tidsplan og baner, formater og videre spill, resultater og tilgang. Funnene er bevist
med tester mot ekte kode (og SQL-funksjonene kjørt i PGlite med migrasjon 0001–0019),
og de alvorligste er i tillegg kontrollert i koden for hånd. Ingen produktkode er endret.

Alvorlighet: 🔴 gir feil resultat eller kan stoppe et arrangement · 🟠 sannsynlig feil
ved vanlig bruk · 🟡 kanttilfelle.

---

## Tidsplan og baner

| # | | Funn | Hvor |
|---|---|------|------|
| A1 | 🔴 | **Gruppespill bruker bare bane 1–2 (eller 1–3), uansett antall baner.** Banen settes på forhånd per runde og per gruppe (telleren starter på null i hver runde/gruppe), og tidsplanleggeren respekterer alltid en forhåndssatt bane. Gruppene spilles etter hverandre i stedet for samtidig. 12 lag/3 grupper/6 baner: 90 min i dag, 30 min mulig. Gjelder også vanlig liga når antall kamper per runde ikke går opp i antall baner (9 lag/3 baner: 180 → 120 min). «Kall opp» har heller ingenting å tilby på bane 3+. Veiviserens sluttid speiler feilen. | `roundRobin.ts:63`, `build.ts:305–384`, `schedule.ts:139`, `estimate.ts` |
| A2 | 🟠 | **Hviletid gjelder ikke over fasegrenser.** Sluttspillets første runde og hver ny sveitsisk runde planlegges uten å vite når lagene sist spilte — et lag kan få 0 min hvile selv om arrangøren har satt 20. | `schedule.ts:97`, `playoff.ts:70`, `swiss.ts:38` |
| A3 | 🟠 | **Neste fase venter på planlagt slutt for alle tidligere kamper**, også kamper som aldri kan spilles (sluttspill startet tidlig) og kamper som ble ferdige før tiden. Sluttspillet kan få klokkeslett timer frem i tid. | `playoff.ts:74`, `swiss.ts:41` |
| A4 | 🟠 | **«Forsink» på én bane kan legge en finale før sin egen semifinale**, og et lag kan få to kamper samtidig. Klient og server er ellers helt enige (150 tilfeldige tester). | `schedule.ts:246`, migr. `0013` |
| A5 | 🟡 | «Start kamp» sjekker ikke at begge lag er kjent eller at banen er ledig — en kamp med «Avventer» kan gå live og ikke avsluttes. | `match/lock/route.ts:61` |
| A6 | 🟡 | Nedtellingen ligger på banen og nullstilles ikke når kampen er ferdig — neste kamp arver gammel tid. Ukjent `action` starter en 10-min-nedtelling. | resultat-/timer-rutene |
| A7 | 🟡 | «Angre oppkalling» setter ikke kampen tilbake til opprinnelig bane. | migr. `0014` |

## Formater og videre spill

| # | | Funn | Hvor |
|---|---|------|------|
| B1 | 🟠 | **Lag fra samme gruppe møtes i første sluttspillrunde** (f.eks. 3 grupper × 2 videre: C1 mot C2). Med 4 grupper × 2 havner vinner og toer fra samme gruppe i samme halvdel og kan møtes i semifinalen. Kommentaren i koden lover det motsatte. Gjelder også B-sluttspill. | `groups.ts:28` |
| B2 | 🟠 | **Finalen står før bronsefinalen i køen, og når finalen er spilt, avsluttes turneringen — bronsefinalen kan da ikke registreres** uten å gjenåpne, og må avsluttes manuelt etterpå. | `build.ts` (`persistBracketSet`), migr. `0019` |
| B3 | 🟠 | **Sluttplassering/diplom ignorerer hvor langt lagene kom i sluttspillet** når det finnes en serietabell: kvartfinaletapere kan bli nr. 3–4 foran semifinaletaperne. B-finalens vinner kan stå under taperen. | `view.ts` `finalRanking` |
| B4 | 🟠 | **«Avslutt» før finalen viser feil vinner**: i cup en semifinaletaper; i liga + sluttspill serievinneren selv om den røk ut i kvartfinalen. | `view.ts:62`, `ResultClient.tsx` |
| B5 | 🟡 | Speaker-teksten finner «finalen» uten å kreve bracket-plass 0 — en bronsefinale kan kåres som mester hvis rekkefølgen endres (blir aktuelt når B2 rettes). | `narrate.ts:361, 389` |
| B6 | 🟡 | Gruppevinnere seedes etter gruppebokstav, ikke resultat; ulike gruppestørrelser sammenlignes ikke rettferdig. | `groups.ts:30` |
| B7 | 🟡 | Sveitsisk system med nesten N−1 runder gir omkamper og gjentatte frirunder (innenfor standard antall runder: 0). | `swiss.ts` |
| B8 | 🟡 | Overstyring av en seriekamp etter at sluttspillet er laget, endrer tabellen men ikke sluttspillet — uten advarsel. | override-ruten |
| B9 | 🟡 | Den annullerte omkampen i dobbel utslag (finale 2) kan overstyres og snu vinneren. | override-ruten |

## Resultater, tabell og tilgang

| # | | Funn | Hvor |
|---|---|------|------|
| C1 | 🟠 | **Låseruten skriver status uten å sjekke at den fortsatt stemmer.** Ved dårlig nett (lagring går gjennom på serveren samtidig som telefonen gir opp og lukker vinduet) kan «lukk» sette en ferdig kamp tilbake til «planlagt» uten resultat — og køen på telefonen tror resultatet er sendt. «Start»/«Ta over» kan også gjøre en ferdig kamp live igjen. | `match/lock/route.ts:63, 72, 99` |
| C2 | 🟠 | **Dommerens «Endre» (4-min-vinduet) sjekker ikke at serien er avsluttet** — et rettet seriresultat etter at sluttspillet er seedet endrer tabellen, men ikke sluttspillet. Vanlig «Lagre» avviser det samme. | `match/correct/route.ts:54` |
| C3 | 🟠 | **En dommer kan bruke «Endre» på en annen dommers resultat**: enhets-id-en som avgjør hvem som lagret, ligger i de offentlige dataene (`select *`). Krever dommerkoden og at det skjer innen 4 minutter. | `correct/route.ts:42`, `store.ts` |
| C4 | 🟠 | **«Best av N» kontrolleres aldri for sett**: best av 3 godtar 5–0 i sett, 3–2, eller ett enkelt sett som ferdig kamp. Påvirker settdifferanse i tabellen. | `scoring.ts:101` |
| C5 | 🟠 | Dommeren for finalen kan aldri bruke «Endre», fordi finalen avslutter turneringen — knappen vises likevel. | `correct/route.ts:54` |
| C6 | 🟡 | Hvis videreføringen til neste runde feiler etter lagring, får dommeren likevel «Lagret» — neste kamp blir stående «Avventer». | resultat-/correct-rutene |
| C7 | 🟡 | Et resultat som ligger i telefonens kø, er lagret som «hjemme/borte», ikke lag. Hvis lagene i kampen byttes av en overstyring før sending, krediteres feil lag. | `outbox.ts`, migr. `0015` |
| C8 | 🟡 | «Kveldens lag» er serievinneren selv om et annet lag vant finalen; angrep/forsvar bruker totaler, så lag med færre kamper får «tettest forsvar». | `awards.ts` |
| C9 | 🟡 | Walkover teller alltid 1–0 (også i settprofil, der en vanlig seier er 3–0). | `build.ts:283` |

## Kontrollert og funnet riktig

Rundenes parring (2–17 lag, enkel/dobbel), alle sluttspilltrær (cup 2–20 lag, dobbel utslag 3–32,
B-sluttspill, trøsterunde) inkludert frirunder og videreføring, overstyring med kaskade (tilfeldige tester),
poeng og tiebreak (også tre lag likt), samtidige registreringer (nøyaktig én vinner), gjentatt sending fra kø,
tilgangskontroll på alle arrangørruter, paringsbillett bundet til turnering, sperre mot gjetting av kode,
tidssone/sommertid, og klient/server-likhet for «Forsink».

---

## Forslag til rettelser — 4 PR-er

**L1 — Baner og tid** (A1–A6): planleggeren velger bane for liga/gruppe (ikke forhåndssatt), gruppene
flettes runde for runde, hvile tas med over fasegrenser, neste fase regnes fra faktisk status,
«Forsink» på én bane varsler ved kollisjon, «Start kamp» krever kjente lag, nedtelling nullstilles ved
resultat. Veiviserens sluttid følger med. Ingen databaseendring.

**L2 — Sluttspill og vinner** (B1, B3–B9, C8): seeding som holder gruppekamerater fra hverandre (og
etter resultat), riktig sluttplassering og vinner ved tidlig avslutning, speaker krever finaleplass,
advarsler for mange sveitsiske runder og for overstyring etter seeding, avvis overstyring av annullert
finale 2, utmerkelser i tråd med vinneren. Ingen databaseendring.

**L3 — Resultater og tilgang** (C1–C6, C9): statusvakt på alle skrivinger i låseruten, samme
sperrer i «Endre» som i «Lagre», «Endre» bundet til en hemmelig nøkkel per enhet i stedet for den
offentlige id-en, sett-regler for «best av N» (også i registreringsvinduet), «Endre» på finalen,
varsel når videreføringen feiler. Ingen databaseendring.

**L4 — Databaseendring (migrasjon 0020)** (B2, A7, C7): turneringen avsluttes først når også
bronsefinalen er spilt, og bronsefinalen settes før finalen i køen; «Angre oppkalling» gir tilbake
opprinnelig bane; kampens versjon øker når lagene i den byttes (så et utdatert resultat i kø avvises).
**Krever at du kjører SQL-en i Supabase før deploy**, som ved tidligere migrasjoner. Testes i PGlite først.

Rekkefølge: L3 → L1 → L2 → L4, hver PR verifisert før neste, deploy samlet til slutt.
