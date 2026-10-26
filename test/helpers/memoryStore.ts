// Gjenbrukbar test-hjelper: en minnebasert erstatning for `lib/server/store`, så
// de ekte byggerne (createTournament / advanceToPlayoff / insertSwissRound) kan
// kjøres uten database, og et sett invarianter som en tidsplan må oppfylle
// (lag, baner, hvile, matere, ledige baner). Brukes slik:
//
//   vi.mock("@/lib/server/store", async () => (await import("./helpers/memoryStore")).storeMock);
//
// Støtter akkurat de spørringene byggerne bruker (select/insert/update/delete
// med eq/is/order/limit/maybeSingle/single). Ikke en generell Supabase-emulator.

import type { Court, Match, ScheduleConfig, Team, Tournament } from "@/lib/types";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let idSeq = 0;

export function resetStore(): void {
  for (const k of Object.keys(tables)) delete tables[k];
  idSeq = 0;
}
const tbl = (name: string): Row[] => (tables[name] ??= []);

/** UUID-lignende id som består `isUuid`. */
const nextId = () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, "0")}`;

const DEFAULTS: Record<string, () => Row> = {
  matches: () => ({
    group_no: null,
    bracket_slot: null,
    called_at: null,
    result: null,
    winner_team_id: null,
    locked_by: null,
    result_by: null,
    result_version: 0,
    scheduled_at: null,
    updated_at: new Date().toISOString(),
  }),
  courts: () => ({ timer: null }),
  teams: () => ({ group_no: null }),
};

class Query implements PromiseLike<{ data: unknown; error: null | { message: string } }> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private filters: ((r: Row) => boolean)[] = [];
  private payload: Row | Row[] = [];
  private returning = false;
  private orderBy: { col: string; asc: boolean } | null = null;
  private max = Infinity;
  private mode: "many" | "maybe" | "single" = "many";

  constructor(private table: string) {}

  select(_cols?: string) {
    this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) {
    this.orderBy = { col, asc: o?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }

  private exec(): { data: unknown; error: null | { message: string } } {
    const rows = tbl(this.table);
    const hit = () => rows.filter((r) => this.filters.every((f) => f(r)));
    let out: Row[] = [];
    if (this.op === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const p of list) {
        const row = { id: nextId(), ...(DEFAULTS[this.table]?.() ?? {}), ...p };
        rows.push(row);
        out.push(row);
      }
    } else if (this.op === "update") {
      out = hit();
      for (const r of out) Object.assign(r, this.payload, { updated_at: new Date().toISOString() });
    } else if (this.op === "delete") {
      out = hit();
      tables[this.table] = rows.filter((r) => !out.includes(r));
    } else {
      out = hit();
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out = [...out].sort((a, b) => {
        const x = a[col] as number | string;
        const y = b[col] as number | string;
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      });
    }
    out = out.slice(0, this.max);
    if (this.op !== "select" && !this.returning) return { data: null, error: null };
    if (this.mode === "many") return { data: out, error: null };
    if (this.mode === "maybe") return { data: out[0] ?? null, error: null };
    return out[0]
      ? { data: out[0], error: null }
      : { data: null, error: { message: "no rows" } };
  }

  then<A, B>(
    ok?: ((v: { data: unknown; error: null | { message: string } }) => A | PromiseLike<A>) | null,
    err?: ((e: unknown) => B | PromiseLike<B>) | null,
  ) {
    return Promise.resolve().then(() => this.exec()).then(ok, err);
  }
}

export const storeMock = {
  db: () => ({ from: (t: string) => new Query(t) }),
  getTournament: async (id: string) => (tbl("tournaments").find((t) => t.id === id) as unknown as Tournament) ?? null,
  getTeams: async (id: string) =>
    tbl("teams")
      .filter((r) => r.tournament_id === id)
      .sort((a, b) => (a.sort_order as number) - (b.sort_order as number)) as unknown as Team[],
  getCourts: async (id: string) =>
    tbl("courts")
      .filter((r) => r.tournament_id === id)
      .sort((a, b) => (a.sort_order as number) - (b.sort_order as number)) as unknown as Court[],
  getMatches: async (id: string) =>
    tbl("matches")
      .filter((r) => r.tournament_id === id)
      .sort((a, b) => (a.queue_order as number) - (b.queue_order as number)) as unknown as Match[],
  bumpVersion: async () => {},
};

// ---------- Uthenting for testene ----------

export const storedTournament = (id: string) => tbl("tournaments").find((t) => t.id === id) as unknown as Tournament;
export const storedMatches = (id: string) => storeMock.getMatches(id);
export const storedCourts = (id: string) => storeMock.getCourts(id);
export const storedLinks = () =>
  tbl("bracket_links") as unknown as { from_match_id: string; to_match_id: string }[];

/** Spill ferdig alle uspilte seriekamper: hjemmelaget vinner 1–0, resultatet
 * lagres `endAt` ms etter planlagt start (slik `updated_at` ville blitt satt). */
export function finishLeague(id: string, cfg: ScheduleConfig, finishAt?: (m: Match) => number): void {
  for (const r of tbl("matches")) {
    if (r.tournament_id !== id || r.phase !== "league" || r.status !== "scheduled") continue;
    const m = r as unknown as Match;
    const end = finishAt?.(m) ?? (m.scheduled_at ? Date.parse(m.scheduled_at) + cfg.matchMinutes * 60_000 : Date.now());
    Object.assign(r, {
      status: "done",
      result: { home: 1, away: 0 },
      winner_team_id: m.home_team_id,
      updated_at: new Date(end).toISOString(),
    });
  }
}

// ---------- Invarianter ----------

const MIN = 60_000;

export interface Violation {
  kind: "team_overlap" | "court_overlap" | "rest" | "feeder" | "feeder_rest";
  detail: string;
}

/** Sluttidspunkt (ms) for en kamp: faktisk (`updated_at`) for ferdige, ellers planlagt. */
function endOf(m: Match, cfg: ScheduleConfig): number | null {
  if (m.status === "done") return Date.parse(m.updated_at);
  return m.scheduled_at ? Date.parse(m.scheduled_at) + cfg.matchMinutes * MIN : null;
}
function startOf(m: Match, cfg: ScheduleConfig): number | null {
  if (m.status === "done") return Date.parse(m.updated_at) - cfg.matchMinutes * MIN;
  return m.scheduled_at ? Date.parse(m.scheduled_at) : null;
}

/** Sjekk tidsplanen mot reglene: ingen lag spiller to kamper samtidig eller med
 * mindre hvile enn `minRestMinutes`, ingen bane har to kamper i samme slot
 * (kamp + pause), og en brakettkamp starter ikke før materne er ferdige (+ hvile).
 * `only` begrenser sjekken til par der minst én kamp er i settet (f.eks. bare nye
 * sluttspillkamper mot alt som kom før). Ferdige kamper regnes med faktisk tid. */
export function checkSchedule(
  matches: Match[],
  cfg: ScheduleConfig,
  links: { from_match_id: string; to_match_id: string }[] = [],
  only?: (m: Match) => boolean,
): Violation[] {
  const out: Violation[] = [];
  const rest = cfg.minRestMinutes * MIN;
  const timed = matches.filter((m) => m.status !== "bye" && startOf(m, cfg) !== null);
  const byTeam = new Map<string, Match[]>();
  for (const m of timed)
    for (const t of [m.home_team_id, m.away_team_id])
      if (t) byTeam.set(t, [...(byTeam.get(t) ?? []), m]);
  for (const [team, list] of byTeam) {
    const sorted = [...list].sort((a, b) => startOf(a, cfg)! - startOf(b, cfg)!);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      if (only && !only(prev) && !only(next)) continue;
      const gap = startOf(next, cfg)! - endOf(prev, cfg)!;
      if (gap < 0) out.push({ kind: "team_overlap", detail: `${team}: ${prev.id} / ${next.id}` });
      else if (gap < rest) out.push({ kind: "rest", detail: `${team}: ${gap / MIN} min mellom ${prev.id} og ${next.id}` });
    }
  }
  const slot = (cfg.matchMinutes + cfg.breakMinutes) * MIN;
  const byCourt = new Map<string, Match[]>();
  for (const m of timed)
    if (m.court_id && m.status !== "done") byCourt.set(m.court_id, [...(byCourt.get(m.court_id) ?? []), m]);
  for (const [court, list] of byCourt) {
    const sorted = [...list].sort((a, b) => startOf(a, cfg)! - startOf(b, cfg)!);
    for (let i = 1; i < sorted.length; i++) {
      if (only && !only(sorted[i - 1]) && !only(sorted[i])) continue;
      if (startOf(sorted[i], cfg)! < startOf(sorted[i - 1], cfg)! + slot)
        out.push({ kind: "court_overlap", detail: `${court}: ${sorted[i - 1].id} / ${sorted[i].id}` });
    }
  }
  const byId = new Map(matches.map((m) => [m.id, m]));
  for (const l of links) {
    const from = byId.get(l.from_match_id);
    const to = byId.get(l.to_match_id);
    if (!from || !to || from.status === "bye" || to.status === "bye") continue;
    if (only && !only(from) && !only(to)) continue;
    const fe = endOf(from, cfg);
    const ts = startOf(to, cfg);
    if (fe === null || ts === null) continue;
    if (ts < fe) out.push({ kind: "feeder", detail: `${from.id} → ${to.id}` });
    else if (ts < fe + rest) out.push({ kind: "feeder_rest", detail: `${from.id} → ${to.id}` });
  }
  return out;
}

/** Banene som faktisk har minst én kamp. */
export const usedCourts = (matches: Match[]) =>
  new Set(matches.filter((m) => m.status !== "bye" && m.court_id).map((m) => m.court_id as string));

/** Når siste kamp er ferdig (ms), planlagt. */
export function lastEnd(matches: Match[], cfg: ScheduleConfig): number {
  let end = 0;
  for (const m of matches) {
    if (m.status === "bye" || !m.scheduled_at) continue;
    end = Math.max(end, Date.parse(m.scheduled_at) + cfg.matchMinutes * MIN);
  }
  return end;
}
