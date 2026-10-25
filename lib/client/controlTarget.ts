// Mål for en QR-skanning på /kontroll: `?match=<id>` åpner kampen, `?court=<id>`
// fester banen (kampkort og banekort fra /skriv-ut). Rene funksjoner — selve
// koden i URL-en brukes av paringssiden; her er det bare id-ene.

import type { Court, Match } from "@/lib/types";

export interface ControlTarget {
  match: string | null;
  court: string | null;
}

// Id-ene er uuid-er; avvis alt annet i stedet for å slå dem opp.
const ID = /^[0-9a-zA-Z-]{8,64}$/;

export function parseControlTarget(search: string | URLSearchParams): ControlTarget {
  const p = typeof search === "string" ? new URLSearchParams(search) : search;
  const pick = (k: string) => {
    const v = p.get(k);
    return v && ID.test(v) ? v : null;
  };
  return { match: pick("match"), court: pick("court") };
}

/** Legger målet på en sti (brukes når /kontroll sender videre etter paring). */
export function withControlTarget(path: string, target: ControlTarget): string {
  const q = new URLSearchParams();
  if (target.match) q.set("match", target.match);
  if (target.court) q.set("court", target.court);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export type TargetAction =
  | { kind: "pinCourt"; courtId: string }
  | { kind: "openMatch"; match: Match }
  | { kind: "matchDone" } // ferdig: kan ikke føres på nytt
  | { kind: "matchNotReady" } // lagene er ikke avgjort ennå
  | { kind: "missing" }; // finnes ikke (mer) i turneringen

/** Hva ControlClient skal gjøre med målet. Kamp går foran bane. Null = ingen mål. */
export function resolveControlTarget(
  target: ControlTarget,
  matches: Match[],
  courts: Pick<Court, "id">[],
): TargetAction | null {
  if (target.match) {
    const m = matches.find((x) => x.id === target.match);
    if (!m || m.status === "bye") return { kind: "missing" };
    if (m.status === "done") return { kind: "matchDone" };
    if (!m.home_team_id || !m.away_team_id) return { kind: "matchNotReady" };
    return { kind: "openMatch", match: m };
  }
  if (target.court) {
    return courts.some((c) => c.id === target.court)
      ? { kind: "pinCourt", courtId: target.court }
      : { kind: "missing" };
  }
  return null;
}
