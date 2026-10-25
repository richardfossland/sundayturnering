# Tredjepartsvarsler

SundayTurnering er MIT-lisensiert (se `LICENSE`). Følgende åpne prosjekter har
gitt idéer eller algoritmer som er skrevet om i denne koden.

## CourtHive tods-competition-factory

- Kilde: https://github.com/CourtHive/tods-competition-factory
- Lisens: MIT
- Brukt i: `lib/tournament/schedule.ts` — hvilesjekk per lag (`checkRecoveryTime`)
  og avhengighetsrekkefølge i brakett (`checkDependenciesScheduled`).
- Brukt i: `lib/tournament/standings.ts` — innbyrdes oppgjør som minitabell, rekursivt
  på lag som fortsatt er like (`roundRobinTally/getGroupOrder.ts`).

```
MIT License

Copyright (c) CourtHive

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## brackets-viewer.js og bracketry

- Kilder: https://github.com/Drarig29/brackets-viewer.js og https://github.com/sbachinin/bracketry
- Lisens: MIT
- Brukt i: `lib/tournament/bracketLayout.ts` og `app/board/[id]/Bracket.tsx` — kun idéer
  (kolonne per runde med kamper midt mellom matere; utheving av lagets vei). Ingen kode er portet.

## brackets-manager.js og CourtHive (trøsterunde / B-sluttspill)

- Kilder: https://github.com/Drarig29/brackets-manager.js (`consolationFinal`) og
  https://github.com/CourtHive/tods-competition-factory (`firstRoundLoserConsolation`)
- Lisens: MIT
- Brukt i: `lib/tournament/consolation.ts` — kun idéene (taperne av første runde, eller lagene
  som ikke kom til hovedbraketten, spiller en egen brakett). Ingen kode er portet.

## brackets-manager.js og nadersafa1/double-elimination (dobbel utslag)

- Kilder: brackets-manager.js av Drarig29 (rekkefølgen taperne slippes inn i taperbraketten) og
  nadersafa1/double-elimination (kobling av taperrutene), begge på GitHub
- Lisens: MIT
- Brukt i: `lib/tournament/doubleElim.ts` — kun idéene (taperbrakettens form, at inndroppet snus
  annenhver gang for å unngå omkamper, storfinale med omkamp). Koden er skrevet på nytt for våre
  typer og koblinger; ingen kode er portet, så MIT-teksten er ikke gjengitt på nytt (den står under
  CourtHive-seksjonen).

## edmonds-blossom (vendoret) og dambrisco/swiss-pairing (Swiss-parring)

- Kilder: https://github.com/mattkrick/EdmondsBlossom (npm `edmonds-blossom@1.0.0`, portert fra
  Joris van Rantwijks Python-implementasjon, http://jorisvr.nl/maximummatching.html) og
  https://github.com/dambrisco/swiss-pairing
- Lisens: MIT (edmonds-blossom, Copyright (c) 2015 mattkrick; LICENSE-filen i pakken verifisert mot
  GitHub-repoet), MIT (swiss-pairing)
- Brukt i: `lib/vendor/edmonds-blossom.js` — vendoret kildekode (maksimal vektet matching). Endret kun slik:
  `module.exports` → `export default`, og fire implisitte globale variabler (`b`, `path`, `v`) deklarert
  med `var` fordi ES-moduler er strenge. Full lisenstekst og kildehenvisning står i filhodet.
  `lib/tournament/swiss.ts` bruker ideen fra swiss-pairing (vekt som favoriserer lik stilling og straffer
  omkamp tungt, løst som matching); koden er skrevet på nytt, ingenting er portert derfra.

```
The MIT License (MIT)

Copyright (c) 2015 mattkrick

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## @echecs/buchholz og @echecs/sonneborn-berger (Swiss-tiebreak)

- Kilder: https://github.com/echecsjs/buchholz og https://github.com/echecsjs/sonneborn-berger
- Lisens: MIT
- Brukt i: `lib/tournament/standings.ts` — kun idéene (Buchholz = summen av motstandernes poeng,
  «cut 1» uten den laveste, Sonneborn-Berger = motstanderens poeng for seier, halvparten for uavgjort).
  Koden er skrevet på nytt for våre typer; ingen kode er portet.
