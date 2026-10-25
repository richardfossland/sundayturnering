// Baneoversikt + oppkalling (A3). Ren modul — ingen DB, ingen UI.
//
// Idéene er hentet fra CourtHive TMX («court strip»: hva spilles nå / hva er
// neste per bane), start.gg-stasjoner (kall opp til en bane) og Cup2000
// (nedtelling til laget er uthvilt). Reglene speiler RPC-en `call_match`
// (migrasjon 0014); ruta bruker `callError` til pene feil, databasen har siste ord.

import type { Match, Court } from "@/lib/types";

const MIN = 60_000;

type CourtLike = Pick<Court, "id" | "name" | "sort_order">;
type MatchLike = Pick<
  Match,
  | "id"
  | "court_id"
  | "queue_order"
  | "scheduled_at"
  | "home_team_id"
  | "away_team_id"
  | "status"
  | "updated_at"
>;

export interface CourtLane<M extends MatchLike = MatchLike> {
  court: CourtLike;
  live: M | null;
  called: M | null;
  /** Planlagte kamper låst til banen, tidligst først. */
  next: M[];
}

/** Rekkefølge for «neste»: klokkeslett (uten tid sist), så køen. */
function byOrder(a: MatchLike, b: MatchLike): number {
  const ta = a.scheduled_at ? Date.parse(a.scheduled_at) : Infinity;
  const tb = b.scheduled_at ? Date.parse(b.scheduled_at) : Infinity;
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.queue_order - b.queue_order;
}

const ready = (m: MatchLike) =>
  m.status === "scheduled" && m.home_team_id !== null && m.away_team_id !== null;

/** Lag som spiller eller er kalt opp akkurat nå (kan ikke kalles opp igjen). */
export function busyTeams(matches: MatchLike[]): Set<string> {
  const out = new Set<string>();
  for (const m of matches) {
    if (m.status !== "live" && m.status !== "called") continue;
    if (m.home_team_id) out.add(m.home_team_id);
    if (m.away_team_id) out.add(m.away_team_id);
  }
  return out;
}

/** Millisekunder til laget er uthvilt (0 = hvilt). Hvilen regnes fra siste
 * ferdige kamp (`updated_at` settes når resultatet lagres). Uten
 * minste-hvile eller uten spilt kamp er laget alltid hvilt. */
export function restRemaining(
  teamId: string,
  matches: MatchLike[],
  nowIso: string,
  minRestMinutes: number,
): number {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now) || !(minRestMinutes > 0)) return 0;
  let last = -Infinity;
  for (const m of matches) {
    if (m.status !== "done") continue;
    if (m.home_team_id !== teamId && m.away_team_id !== teamId) continue;
    const t = Date.parse(m.updated_at);
    if (Number.isFinite(t)) last = Math.max(last, t);
  }
  if (last === -Infinity) return 0;
  return Math.max(0, last + minRestMinutes * MIN - now);
}

/** Lengste gjenstående hvile blant kampens to lag, og hvilket lag det gjelder. */
export function matchRest(
  m: MatchLike,
  matches: MatchLike[],
  nowIso: string,
  minRestMinutes: number,
): { teamId: string | null; ms: number } {
  let best: { teamId: string | null; ms: number } = { teamId: null, ms: 0 };
  for (const id of [m.home_team_id, m.away_team_id]) {
    if (!id) continue;
    const ms = restRemaining(id, matches, nowIso, minRestMinutes);
    if (ms > best.ms) best = { teamId: id, ms };
  }
  return best;
}

/** Én kolonne per bane: kamp i gang, kalt opp og de neste. */
export function courtStrip<M extends MatchLike>(
  matches: M[],
  courts: CourtLike[],
  nextLimit = 3,
): CourtLane<M>[] {
  return [...courts]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((court) => {
      const here = matches.filter((m) => m.court_id === court.id);
      return {
        court,
        live: here.find((m) => m.status === "live") ?? null,
        called: here.find((m) => m.status === "called") ?? null,
        next: here.filter(ready).sort(byOrder).slice(0, nextLimit),
      };
    });
}

/** Er banen ledig for en ny oppkalling? */
export function courtFree(courtId: string, matches: MatchLike[]): boolean {
  return !matches.some(
    (m) => m.court_id === courtId && (m.status === "live" || m.status === "called"),
  );
}

/** Kamper som kan kalles opp til `courtId` (uavhengig av hvile): begge lag kjent
 * og ikke i gang/kalt andre steder; kun kamper uten bane eller låst til denne.
 * Tidligst først. Tom hvis banen er opptatt. */
export function callCandidates<M extends MatchLike>(courtId: string, matches: M[]): M[] {
  if (!courtFree(courtId, matches)) return [];
  const busy = busyTeams(matches);
  return matches
    .filter(
      (m) =>
        ready(m) &&
        (m.court_id === null || m.court_id === courtId) &&
        !busy.has(m.home_team_id!) &&
        !busy.has(m.away_team_id!),
    )
    .sort(byOrder);
}

/** Tidligste kamp som kan kalles opp til `courtId` med begge lag uthvilt.
 * Null hvis banen er opptatt eller ingen passer. */
export function suggestNext<M extends MatchLike>(
  courtId: string,
  matches: M[],
  nowIso: string,
  minRestMinutes: number,
): M | null {
  return (
    callCandidates(courtId, matches).find(
      (m) => matchRest(m, matches, nowIso, minRestMinutes).ms === 0,
    ) ?? null
  );
}

export type CallError =
  | "kamp_ikke_klar" // ikke planlagt, eller mangler lag
  | "bane_finnes_ikke"
  | "bane_opptatt" // live/kalt kamp på banen
  | "lag_opptatt"; // et av lagene spiller/er kalt opp andre steder

/** Forhåndssjekk av en oppkalling (samme regler som RPC-en, pluss «lag opptatt»
 * som RPC-en ikke vet om). Hvile er ikke en feil: den vises som bekreftelse. */
export function callError(
  match: MatchLike | undefined,
  courtId: string,
  courts: CourtLike[],
  matches: MatchLike[],
): CallError | null {
  if (!match || !ready(match)) return "kamp_ikke_klar";
  if (!courts.some((c) => c.id === courtId)) return "bane_finnes_ikke";
  if (!courtFree(courtId, matches)) return "bane_opptatt";
  const busy = busyTeams(matches);
  if (busy.has(match.home_team_id!) || busy.has(match.away_team_id!)) return "lag_opptatt";
  return null;
}
