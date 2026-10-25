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
