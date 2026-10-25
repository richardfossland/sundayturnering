import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// Migrasjon 0019 (rettelser fra gjennomgangen) mot en ekte Postgres i minnet:
// hele 0001…0019, pluss et scenario der 0016 og 0017 kjøres på nytt ETTER 0018
// (som å kjøre eldre filer om igjen i SQL-editoren) og 0019 reparerer tilstanden.

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");
const file = (name: string) => readFileSync(join(MIGRATIONS, name), "utf8");
const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const named = (prefix: string) => all.find((f) => f.startsWith(prefix))!;

async function boot(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema realtime;
    create function realtime.topic() returns text language sql stable
      as $$ select nullif(current_setting('realtime.topic', true), '') $$;
    create table realtime.messages (
      id uuid primary key default gen_random_uuid(),
      topic text not null, extension text not null, payload jsonb, event text, private boolean default true
    );
    alter table realtime.messages enable row level security;
    grant execute on function realtime.topic() to anon, authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
  `);
  return db;
}

async function uid(db: PGlite): Promise<string> {
  return (await db.query<{ id: string }>("select gen_random_uuid()::text as id")).rows[0].id;
}
let codeN = 100000;
async function tournament(db: PGlite, format: string, status = "playoff"): Promise<string> {
  const t = await uid(db);
  await db.query(
    `insert into turnering.tournaments (id, control_code, board_code, organiser_code, format, status)
     values ($1, $2, $3, 'o', $4, $5)`,
    [t, String(codeN++), `b${codeN}`, format, status],
  );
  return t;
}
async function team(db: PGlite, t: string, name: string): Promise<string> {
  const id = await uid(db);
  await db.query("insert into turnering.teams (id, tournament_id, name) values ($1, $2, $3)", [id, t, name]);
  return id;
}
async function match(
  db: PGlite,
  t: string,
  o: { bracket?: string; round?: number; slot?: number; home?: string | null; away?: string | null; status?: string; winner?: string | null; phase?: string },
): Promise<string> {
  const id = await uid(db);
  await db.query(
    `insert into turnering.matches
       (id, tournament_id, phase, round, bracket_slot, bracket, home_team_id, away_team_id, status, winner_team_id, result_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)`,
    [id, t, o.phase ?? "playoff", o.round ?? 1, o.slot ?? 0, o.bracket ?? "A", o.home ?? null, o.away ?? null, o.status ?? "scheduled", o.winner ?? null],
  );
  return id;
}
const link = (db: PGlite, t: string, from: string, to: string, slot: string, feed = "winner") =>
  db.query(
    `insert into turnering.bracket_links (tournament_id, from_match_id, to_match_id, to_slot, feed)
     values ($1, $2, $3, $4, $5)`,
    [t, from, to, slot, feed],
  );
const row = async (db: PGlite, id: string) =>
  (await db.query<Record<string, unknown>>("select * from turnering.matches where id = $1", [id])).rows[0];

// ---------------------------------------------------------------------------

describe("0019 på fersk database (0001…0019)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await boot();
    for (const f of all) await db.exec(file(f));
    // Idempotent: 0019 på nytt skal ikke feile.
    await db.exec(file(named("0019")));
  });

  it("etterkontrollen i docs/DEPLOY-MIGRATIONS-0012-0019.md er gyldig og helt grønn", async () => {
    const md = readFileSync(join(__dirname, "..", "docs", "DEPLOY-MIGRATIONS-0012-0019.md"), "utf8");
    const sql = /```sql\n([\s\S]*?)```/.exec(md)![1];
    const r = await db.query<{ sjekk: string; ok: boolean | null }>(sql);
    expect(r.rows).toHaveLength(15);
    expect(r.rows.filter((x) => x.ok !== true)).toEqual([]);
  });

  it("godtar alle seks formater", async () => {
    for (const f of ["league", "league_playoff", "cup", "group_playoff", "double_elim", "swiss"])
      await tournament(db, f, "league");
    await expect(tournament(db, "bogus", "league")).rejects.toThrow();
  });

  it("propagate_playoff_result har pinnet search_path og er låst til service_role", async () => {
    const r = await db.query<{ cfg: string[] | null; anon: boolean; pub: boolean; svc: boolean }>(
      `select p.proconfig as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as pub,
              has_function_privilege('service_role', p.oid, 'execute') as svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'turnering' and p.proname = 'propagate_playoff_result'`,
    );
    expect(r.rows[0].cfg).toContain("search_path=\"\"");
    expect([r.rows[0].anon, r.rows[0].pub, r.rows[0].svc]).toEqual([false, false, true]);
  });

  describe("override_match_result nullstiller også oppkalte (called) kamper", () => {
    it("called nedstrøms → scheduled, called_at tømt, plass fjernet", async () => {
      const t = await tournament(db, "cup");
      const [h, a, x] = [await team(db, t, "H"), await team(db, t, "A"), await team(db, t, "X")];
      const m1 = await match(db, t, { round: 1, slot: 0, home: h, away: a, status: "done", winner: h });
      const m2 = await match(db, t, { round: 2, slot: 0, home: h, away: x, status: "scheduled" });
      await link(db, t, m1, m2, "home");
      const court = await uid(db);
      await db.query("insert into turnering.courts (id, tournament_id, name) values ($1, $2, 'Bane 1')", [court, t]);
      await db.query("select turnering.call_match($1, $2)", [m2, court]);
      expect((await row(db, m2)).status).toBe("called");

      // Uten allow_reset: nektes (en oppkalt kamp teller som berørt).
      await expect(
        db.query("select turnering.override_match_result($1, $2::jsonb, 'away', false)", [m1, JSON.stringify({ home: 0, away: 1 })]),
      ).rejects.toThrow(/downstream_played/);

      await db.query("select turnering.override_match_result($1, $2::jsonb, 'away', true)", [m1, JSON.stringify({ home: 0, away: 1 })]);
      const after = await row(db, m2);
      expect(after.status).toBe("scheduled");
      expect(after.called_at).toBeNull();
      // Vinneren er nå bortelaget og propageres inn i plassen som ble nullstilt.
      expect(after.home_team_id).toBe(a);
    });
  });

  describe("submit_match_result: request-id hører til én kamp", () => {
    it("samme id på samme kamp = replay; på en annen kamp = request_id_conflict (P0422)", async () => {
      const t = await tournament(db, "league", "league");
      const [h, a] = [await team(db, t, "H"), await team(db, t, "A")];
      const m1 = await match(db, t, { phase: "league", home: h, away: a, status: "live" });
      const m2 = await match(db, t, { phase: "league", home: h, away: a, status: "live", slot: 1 });
      await db.query("update turnering.matches set result_version = 0 where id in ($1, $2)", [m1, m2]);
      const req = await uid(db);
      const call = (m: string, v: number) =>
        db.query<{ r: { result_version: number } }>(
          "select to_jsonb(turnering.submit_match_result($1, $2, $3::jsonb, $4, 'done', null, $5)) as r",
          [m, v, JSON.stringify({ home: 1, away: 0 }), h, req],
        );
      const first = await call(m1, 0);
      expect(first.rows[0].r.result_version).toBe(1);
      const replay = await call(m1, 0); // forventet versjon er utdatert, men id er kjent
      expect(replay.rows[0].r.result_version).toBe(1);
      await expect(call(m2, 0)).rejects.toMatchObject({ message: expect.stringContaining("request_id_conflict") });
      expect((await row(db, m2)).result_version).toBe(0); // ingenting skrevet
    });
  });

  describe("uncall_match gjenoppretter banen kampen hadde før oppkalling", () => {
    it("tilbake til forrige bane (og tømmer precall_court_id)", async () => {
      const t = await tournament(db, "league", "league");
      const [h, a] = [await team(db, t, "H"), await team(db, t, "A")];
      const m = await match(db, t, { phase: "league", home: h, away: a });
      const [c1, c2] = [await uid(db), await uid(db)];
      await db.query("insert into turnering.courts (id, tournament_id, name) values ($1, $3, 'B1'), ($2, $3, 'B2')", [c1, c2, t]);
      await db.query("update turnering.matches set court_id = $2 where id = $1", [m, c1]);
      await db.query("select turnering.call_match($1, $2)", [m, c2]);
      let r = await row(db, m);
      expect([r.status, r.court_id, r.precall_court_id]).toEqual(["called", c2, c1]);
      await db.query("select turnering.uncall_match($1)", [m]);
      r = await row(db, m);
      expect([r.status, r.court_id, r.precall_court_id, r.called_at]).toEqual(["scheduled", c1, null, null]);
    });

    it("kamp uten bane før oppkalling får ingen bane tilbake", async () => {
      const t = await tournament(db, "league", "league");
      const [h, a] = [await team(db, t, "H"), await team(db, t, "A")];
      const m = await match(db, t, { phase: "league", home: h, away: a });
      const c = await uid(db);
      await db.query("insert into turnering.courts (id, tournament_id, name) values ($1, $2, 'B1')", [c, t]);
      await db.query("select turnering.call_match($1, $2)", [m, c]);
      await db.query("select turnering.uncall_match($1)", [m]);
      expect((await row(db, m)).court_id).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------

describe("0019 reparerer eldre filer kjørt på nytt i feil rekkefølge", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await boot();
    for (const f of all.filter((f) => f < "0019")) await db.exec(file(f));
    // Eldre filer kjørt om igjen ETTER 0018:
    await db.exec(file(named("0016")));
    await db.exec(file(named("0017")));
  });

  it("før 0019 er tilstanden ødelagt: swiss avvises (CHECK fra 0017) og search_path mangler", async () => {
    await expect(tournament(db, "swiss", "league")).rejects.toThrow();
    const r = await db.query<{ cfg: string[] | null }>(
      `select p.proconfig as cfg from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'turnering' and p.proname = 'propagate_playoff_result'`,
    );
    expect(r.rows[0].cfg).toBeNull();
  });

  it("etter 0019: swiss tillates og storfinale-omkampen virker", async () => {
    await db.exec(file(named("0019")));
    await expect(tournament(db, "swiss", "league")).resolves.toBeTruthy();

    const t = await tournament(db, "double_elim");
    const [w, l] = [await team(db, t, "W"), await team(db, t, "L")];
    // Storfinale (GF 1): W-vinner hjemme, L-vinner borte. Omkamp (GF 2) tom.
    const gf1 = await match(db, t, { bracket: "GF", round: 1, slot: 0, home: w, away: l, status: "done", winner: l });
    const gf2 = await match(db, t, { bracket: "GF", round: 2, slot: 0, status: "bye" });
    await link(db, t, gf1, gf2, "home");
    await link(db, t, gf1, gf2, "away", "loser");

    // L-laget (borte) vant storfinalen → omkampen spilles.
    const r = await db.query<{ finished: boolean; propagated: boolean }>(
      "select * from turnering.propagate_playoff_result($1)",
      [gf1],
    );
    expect(r.rows[0]).toEqual({ finished: false, propagated: true });
    const g2 = await row(db, gf2);
    expect([g2.status, g2.home_team_id, g2.away_team_id]).toEqual(["scheduled", l, w]);
  });
});
