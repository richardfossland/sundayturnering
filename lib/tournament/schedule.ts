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

import { isPlayable } from "@/lib/tournament/courts";
import type { Match, ScheduleConfig, TournamentStatus } from "@/lib/types";

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
  /** Når lagene sist var ferdige med en kamp utenfor denne runden (lag → ms), så
   * hviletiden også gjelder over fasegrenser (liga → sluttspill, sveitsisk runde
   * etter runde). Kampene i batchen oppdaterer sin egen kopi; denne røres ikke. */
  priorEnds?: Map<string, number>;
  /** Fylles med hvert lags sluttidspunkt etter planleggingen (inkl. `priorEnds`),
   * så neste fase kan arve det (veiviserens estimat). */
  endsOut?: Map<string, number>;
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
  for (const [id, p] of planSlots(matches, courts, cfg, opts)) out.set(id, p.at);
  return out;
}

/** Som `assignSlots`, men oppgir også banen kampen havnet på (null uten baner). */
export function planSlots(
  matches: SlotMatch[],
  courts: string[],
  cfg: ScheduleConfig,
  opts: AssignOptions = {},
): Map<string, { at: string; courtId: string | null }> {
  const out = new Map<string, { at: string; courtId: string | null }>();
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
  const teamEnd = new Map<string, number>(opts.priorEnds ?? []); // lag → når siste kamp er slutt
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

    out.set(m.id, { at: new Date(start).toISOString(), courtId: courts[lane] ?? null });
    laneFree[lane] = start + slot;
    endOf.set(m.id, start + dur);
    for (const id of [m.home_team_id, m.away_team_id])
      if (id) teamEnd.set(id, start + dur);
  }
  opts.endsOut?.clear();
  for (const [id, e] of teamEnd) opts.endsOut?.set(id, e);
  return out;
}

const FIVE_MIN = 5 * MIN;

/** Hva en ny fase (sluttspill, neste sveitsiske runde) må ta hensyn til fra det
 * som allerede er spilt/planlagt. Bare kamper som fortsatt kan spilles teller
 * (`isPlayable`, f.eks. ikke seriekamper som ble igjen da sluttspillet startet
 * tidlig). Ferdige kamper regnes med FAKTISK slutt (`updated_at`, rundet opp til
 * 5 min), ikke planlagt slutt; kamper som ikke er ferdige med planlagt slutt (en
 * pågående kamp ikke tidligere enn nå).
 *  - `notBefore`: tidligst start for hele fasen = nå rundet opp til 5 min, eller
 *    senere hvis noen kamp fortsatt er i gang/planlagt.
 *  - `teamEnds`: hvert lags siste sluttidspunkt, til `planSlots({ priorEnds })`. */
export function phaseCarryOver(
  matches: Pick<
    Match,
    "phase" | "status" | "scheduled_at" | "updated_at" | "home_team_id" | "away_team_id"
  >[],
  cfg: ScheduleConfig,
  tournamentStatus: TournamentStatus,
  nowMs: number,
): { notBefore: number; teamEnds: Map<string, number> } {
  const teamEnds = new Map<string, number>();
  let notBefore = Math.ceil(nowMs / FIVE_MIN) * FIVE_MIN;
  for (const m of matches) {
    if (m.status === "bye") continue;
    if (m.status !== "done" && !isPlayable(m, tournamentStatus)) continue;
    let end: number | null;
    if (m.status === "done") {
      const t = Date.parse(m.updated_at);
      end = Number.isFinite(t) ? Math.ceil(t / FIVE_MIN) * FIVE_MIN : null;
    } else {
      const planned = matchEnd(m.scheduled_at, cfg);
      end = planned === null ? null : Math.max(planned, nowMs);
      if (end !== null) notBefore = Math.max(notBefore, end);
    }
    if (end === null) continue;
    for (const id of [m.home_team_id, m.away_team_id])
      if (id) teamEnds.set(id, Math.max(teamEnds.get(id) ?? 0, end));
  }
  return { notBefore, teamEnds };
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

// ---------- Forsink eller framskynd kamper (A2) ----------
// Samme regler som RPC `turnering.shift_schedule` (migrasjon 0013). Brukes til
// forhåndsvisning i Kontrollsenteret og til å gi pene feil i ruta; databasen
// har siste ord.

/** Maks forskyvning i minutter (begge retninger). */
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
  /** Flytt kamper som starter på/etter dette tidspunktet (ISO). */
  fromIso: string;
  /** Positivt = utsett, negativt = framskynd. */
  minutes: number;
  nowIso: string;
}

/** Hvilke kamper som flyttes (og til når) om tidsplanen skyves. Ferdige/bye-/live-
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
    if (m.status === "done" || m.status === "bye" || m.status === "live" || !m.scheduled_at) continue;
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
  if (req.minutes < 0 && changes.some((c) => Date.parse(c.after) < now - SHIFT_PAST_SLACK))
    return { changes, error: "skyv_for_tidlig" };
  return { changes, error: null };
}

// ---------- Konflikter ved «Forsink» (A4) ----------
// RPC-en flytter kampene rått (den vet ikke om brakettkoblinger, lag eller
// hvile), og `previewShift` speiler den. Kontrollsenteret bruker denne i tillegg
// til å varsle om det en forskyvning ville ødelagt — særlig på én bane eller med
// negative minutter — før arrangøren bekrefter.

export type ShiftConflictKind =
  | "feeder" // en kamp starter før en kamp som mater den er ferdig
  | "team_overlap" // et lag får to kamper samtidig
  | "rest" // et lag får mindre hvile enn minste hvile
  | "court_overlap"; // to kamper på samme bane i samme slot

export interface ShiftConflict {
  kind: ShiftConflictKind;
  /** Kampen som flyttes. */
  matchId: string;
  /** Den andre kampen i konflikten (mater-kamp, lagets andre kamp, banens andre kamp). */
  otherId: string;
}

type ConflictMatch = Pick<
  Match,
  "id" | "court_id" | "status" | "scheduled_at" | "home_team_id" | "away_team_id"
> & { phase?: Match["phase"] };

/** Konflikter som forskyvningen `changes` NYLIG skaper (det som allerede var i
 * strid før, f.eks. en forsinkelse, nevnes ikke). Ferdige/bye-kamper og kamper
 * som ikke lenger kan spilles (`isPlayable`) inngår ikke. */
export function shiftConflicts(
  matches: ConflictMatch[],
  links: SlotLink[],
  changes: ShiftChange[],
  cfg: ScheduleConfig,
  tournamentStatus?: TournamentStatus,
): ShiftConflict[] {
  if (changes.length === 0) return [];
  const dur = cfg.matchMinutes * MIN;
  const slot = (cfg.matchMinutes + cfg.breakMinutes) * MIN;
  const rest = cfg.minRestMinutes * MIN;
  const moved = new Map(changes.map((c) => [c.matchId, Date.parse(c.after)]));
  const live = matches.filter(
    (m) =>
      m.scheduled_at &&
      Number.isFinite(Date.parse(m.scheduled_at)) &&
      m.status !== "done" &&
      m.status !== "bye" &&
      isPlayable(m, tournamentStatus),
  );
  const byId = new Map(live.map((m) => [m.id, m]));

  const scan = (startOf: (m: ConflictMatch) => number): Map<string, ShiftConflict> => {
    const out = new Map<string, ShiftConflict>();
    const add = (kind: ShiftConflictKind, a: string, b: string) => {
      const key = `${kind}|${[a, b].sort().join("|")}`;
      if (!out.has(key)) out.set(key, { kind, matchId: moved.has(a) ? a : b, otherId: moved.has(a) ? b : a });
    };
    for (const a of live) {
      if (!moved.has(a.id)) continue;
      const as = startOf(a);
      for (const b of live) {
        if (b.id === a.id) continue;
        const bs = startOf(b);
        const sharesTeam = [a.home_team_id, a.away_team_id].some(
          (t) => t && (t === b.home_team_id || t === b.away_team_id),
        );
        if (sharesTeam) {
          const [first, second] = as <= bs ? [as, bs] : [bs, as];
          if (second < first + dur) add("team_overlap", a.id, b.id);
          else if (second < first + dur + rest) add("rest", a.id, b.id);
        }
        if (a.court_id && a.court_id === b.court_id) {
          const [first, second] = as <= bs ? [as, bs] : [bs, as];
          if (second < first + slot) add("court_overlap", a.id, b.id);
        }
      }
    }
    for (const l of links) {
      const from = byId.get(l.from_match_id);
      const to = byId.get(l.to_match_id);
      if (!from || !to || (!moved.has(from.id) && !moved.has(to.id))) continue;
      // Vinneren/taperen av materen trenger også hvile før neste kamp.
      if (startOf(to) < startOf(from) + dur) add("feeder", from.id, to.id);
      else if (startOf(to) < startOf(from) + dur + rest) add("rest", from.id, to.id);
    }
    return out;
  };

  const before = scan((m) => Date.parse(m.scheduled_at!));
  const after = scan((m) => moved.get(m.id) ?? Date.parse(m.scheduled_at!));
  return [...after].filter(([key]) => !before.has(key)).map(([, c]) => c);
}
