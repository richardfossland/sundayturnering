// Tidsplan-motor: gir kampene faktiske klokkeslett. Ren modul — ingen DB, ingen UI.
//
// Idéene bak hvile- og avhengighetssjekken er hentet fra CourtHive
// tods-competition-factory (MIT, https://github.com/CourtHive/tods-competition-factory):
//   - `checkRecoveryTime`          → et lag starter ikke før forrige kamp er slutt + minste hvile
//   - `checkDependenciesScheduled` → en brakettkamp starter ikke før kampene som mater den er ferdige
// Koden er skrevet på nytt for våre typer; se THIRD-PARTY-NOTICES.md.
//
// Algoritme: grådig. Kampene tas i `queue_order`; hver kamp legges på den banen
// (sin egen hvis den er låst til en, ellers den som kan starte tidligst) i det
// første tidspunktet som oppfyller: banen er ledig, begge lag er uthvilt,
// mater-kampene er ferdige og kampen ikke krasjer med en banepause. Hver slot
// varer matchMinutes + breakMinutes. Kamper uten kjente lag (brakett-TBD) får
// likevel slot. Uten baner (sekvensiell) er det én felles tidslinje.

import type { Match, ScheduleConfig } from "@/lib/types";

const MIN = 60_000;

/** Det motoren trenger av en kamp — et utsnitt av `Match` så den også kan
 * kjøres på rader som ennå ikke er lagret (nøkkelen `id` velger kalleren). */
export type SlotMatch = Pick<
  Match,
  "id" | "queue_order" | "court_id" | "home_team_id" | "away_team_id" | "status"
>;

/** Mater-kobling (fra → til); samme betydning som `bracket_links`. */
export interface SlotLink {
  from_match_id: string;
  to_match_id: string;
}

export interface AssignOptions {
  /** Tidligste starttid uansett `cfg.startAt` (sluttspill bygd etter ligaen). */
  notBefore?: Date;
  /** Mater-koblinger mellom kampene (brakett). */
  links?: SlotLink[];
}

/** Banepausene som tall (ms). `courtIndex` null = alle baner. */
function parsedBreaks(cfg: ScheduleConfig) {
  return (cfg.courtBreaks ?? [])
    .map((b) => ({
      courtIndex: b.courtIndex,
      from: Date.parse(b.from),
      to: Date.parse(b.to),
    }))
    .filter((b) => Number.isFinite(b.from) && Number.isFinite(b.to) && b.to > b.from);
}

/** Gi hver kamp et klokkeslett (ISO). Bye-kamper og kamper som allerede er
 * ferdige/pågår får ingen. `courts` er bane-id-ene i rekkefølge; tom = én
 * felles tidslinje (sekvensiell). */
export function assignSlots(
  matches: SlotMatch[],
  courts: string[],
  cfg: ScheduleConfig,
  opts: AssignOptions = {},
): Map<string, string> {
  const out = new Map<string, string>();
  const dur = cfg.matchMinutes * MIN;
  const slot = (cfg.matchMinutes + cfg.breakMinutes) * MIN;
  const rest = cfg.minRestMinutes * MIN;
  const breaks = parsedBreaks(cfg);

  let origin = Date.parse(cfg.startAt);
  if (!Number.isFinite(origin)) return out;
  if (opts.notBefore) origin = Math.max(origin, opts.notBefore.getTime());

  const todo = [...matches]
    .filter((m) => m.status === "scheduled")
    .sort((a, b) => a.queue_order - b.queue_order);
  const inBatch = new Set(todo.map((m) => m.id));

  // kamp → kampene som mater den (kun de som selv skal få slot)
  const feeders = new Map<string, string[]>();
  for (const l of opts.links ?? []) {
    if (!inBatch.has(l.from_match_id) || !inBatch.has(l.to_match_id)) continue;
    const arr = feeders.get(l.to_match_id) ?? [];
    arr.push(l.from_match_id);
    feeders.set(l.to_match_id, arr);
  }

  const lanes = courts.length > 0 ? courts.length : 1;
  const laneFree: number[] = Array(lanes).fill(origin);
  const teamEnd = new Map<string, number>(); // lag → når siste kamp er slutt
  const endOf = new Map<string, number>(); // kamp → sluttidspunkt

  /** Første start ≥ `t` på bane `lane` som ikke overlapper en banepause. */
  function clearOfBreaks(lane: number, t: number): number {
    let s = t;
    for (let moved = true; moved; ) {
      moved = false;
      for (const b of breaks) {
        if (b.courtIndex !== null && b.courtIndex !== lane) continue;
        if (s < b.to && s + dur > b.from) {
          s = b.to;
          moved = true;
        }
      }
    }
    return s;
  }

  function earliest(m: SlotMatch, lane: number): number {
    let t = laneFree[lane];
    for (const id of [m.home_team_id, m.away_team_id]) {
      const e = id ? teamEnd.get(id) : undefined;
      if (e !== undefined) t = Math.max(t, e + rest);
    }
    // Vinneren/taperen av mater-kampen trenger også hvile før neste kamp.
    for (const f of feeders.get(m.id) ?? []) {
      const e = endOf.get(f);
      if (e !== undefined) t = Math.max(t, e + rest);
    }
    return clearOfBreaks(lane, t);
  }

  // Mater-kamper må plasseres før kampen de mater, uansett køen.
  const pending = [...todo];
  while (pending.length > 0) {
    const idx = pending.findIndex((m) =>
      (feeders.get(m.id) ?? []).every((f) => endOf.has(f)),
    );
    const m = pending.splice(idx === -1 ? 0 : idx, 1)[0];

    const pinned = courts.indexOf(m.court_id ?? "");
    const candidates =
      courts.length === 0 ? [0] : pinned >= 0 ? [pinned] : courts.map((_, i) => i);
    let lane = candidates[0];
    let start = earliest(m, lane);
    for (const c of candidates.slice(1)) {
      const s = earliest(m, c);
      if (s < start) {
        start = s;
        lane = c;
      }
    }

    out.set(m.id, new Date(start).toISOString());
    laneFree[lane] = start + slot;
    endOf.set(m.id, start + dur);
    for (const id of [m.home_team_id, m.away_team_id])
      if (id) teamEnd.set(id, start + dur);
  }
  return out;
}

/** Når en planlagt kamp er slutt (ms), eller null uten klokkeslett. */
export function matchEnd(scheduledAt: string | null, cfg: ScheduleConfig): number | null {
  if (!scheduledAt) return null;
  const t = Date.parse(scheduledAt);
  return Number.isFinite(t) ? t + cfg.matchMinutes * MIN : null;
}

const clampInt = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
};

/** Valider/rens tidsplan fra en ukjent kilde (API-body, lagret jsonb).
 * `undefined`/`null` = ingen tidsplan (gyldig). `"invalid"` = forsøkt, men ugyldig. */
export function sanitiseSchedule(raw: unknown): ScheduleConfig | undefined | "invalid" {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") return "invalid";
  const r = raw as Record<string, unknown>;
  if (typeof r.startAt !== "string" || !Number.isFinite(Date.parse(r.startAt))) return "invalid";
  const matchMinutes = clampInt(r.matchMinutes, 1, 240);
  const breakMinutes = clampInt(r.breakMinutes ?? 0, 0, 120);
  const minRestMinutes = clampInt(r.minRestMinutes ?? 0, 0, 480);
  if (matchMinutes === null || breakMinutes === null || minRestMinutes === null)
    return "invalid";

  const courtBreaks: NonNullable<ScheduleConfig["courtBreaks"]> = [];
  if (Array.isArray(r.courtBreaks)) {
    for (const b of r.courtBreaks.slice(0, 20)) {
      const o = (b ?? {}) as Record<string, unknown>;
      const from = typeof o.from === "string" ? Date.parse(o.from) : NaN;
      const to = typeof o.to === "string" ? Date.parse(o.to) : NaN;
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return "invalid";
      const ci =
        o.courtIndex === null || o.courtIndex === undefined ? null : clampInt(o.courtIndex, 0, 31);
      courtBreaks.push({
        courtIndex: ci,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
    }
  }
  return {
    startAt: new Date(Date.parse(r.startAt)).toISOString(),
    matchMinutes,
    breakMinutes,
    minRestMinutes,
    ...(courtBreaks.length ? { courtBreaks } : {}),
  };
}

// ---------- Skyv tidsplanen (A2) ----------
// Samme regler som RPC `turnering.shift_schedule` (migrasjon 0013). Brukes til
// forhåndsvisning i arrangørpanelet og til å gi pene feil i ruta; databasen
// har siste ord.

/** Maks skyv i minutter (begge retninger). */
export const MAX_SHIFT_MINUTES = 240;
/** Slingringsmonn mot «nå» (ms), som `now() - 1 minute` i RPC-en. */
const SHIFT_PAST_SLACK = MIN;

export type ShiftError =
  | "ugyldig_skyv" // manglende/ugyldig input, eller 0 minutter
  | "for_stort_skyv" // |minutter| > MAX_SHIFT_MINUTES
  | "skyv_for_tidlig" // en kamp ville havnet før «nå»
  | "ingen_kamper"; // ingenting å skyve

export interface ShiftChange {
  matchId: string;
  before: string;
  after: string;
}

export interface ShiftRequest {
  /** Bane-id, eller null for alle baner. */
  courtId: string | null;
  /** Skyv kamper som starter på/etter dette tidspunktet (ISO). */
  fromIso: string;
  /** Positivt = utsett, negativt = framskynd. */
  minutes: number;
  nowIso: string;
}

/** Hvilke kamper som flyttes (og til når) om tidsplanen skyves. Ferdige/bye-
 * kamper og kamper uten klokkeslett røres aldri. */
export function previewShift(
  matches: Pick<Match, "id" | "court_id" | "status" | "scheduled_at">[],
  req: ShiftRequest,
): { changes: ShiftChange[]; error: ShiftError | null } {
  const from = Date.parse(req.fromIso);
  const now = Date.parse(req.nowIso);
  if (
    !Number.isInteger(req.minutes) ||
    req.minutes === 0 ||
    !Number.isFinite(from) ||
    !Number.isFinite(now)
  )
    return { changes: [], error: "ugyldig_skyv" };
  if (Math.abs(req.minutes) > MAX_SHIFT_MINUTES)
    return { changes: [], error: "for_stort_skyv" };

  const changes: ShiftChange[] = [];
  for (const m of matches) {
    if (m.status === "done" || m.status === "bye" || !m.scheduled_at) continue;
    if (req.courtId !== null && m.court_id !== req.courtId) continue;
    const t = Date.parse(m.scheduled_at);
    if (!Number.isFinite(t) || t < from) continue;
    changes.push({
      matchId: m.id,
      before: m.scheduled_at,
      after: new Date(t + req.minutes * MIN).toISOString(),
    });
  }
  if (changes.length === 0) return { changes, error: "ingen_kamper" };
  if (changes.some((c) => Date.parse(c.after) < now - SHIFT_PAST_SLACK))
    return { changes, error: "skyv_for_tidlig" };
  return { changes, error: null };
}
