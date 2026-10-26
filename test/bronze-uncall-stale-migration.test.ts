import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// Migrasjon 0020 mot en ekte Postgres i minnet (hele 0001…0020):
//  B2  bronsefinale og finale avgjør turneringen i hvilken som helst rekkefølge
//  A7  «Angre oppkalling» gir tilbake opprinnelig bane (også ingen bane)
//  C7  lagbytte i en kamp utdaterer et resultat som ble sendt mot gammel versjon

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
let codeN = 200000;
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
const tStatus = async (db: PGlite, t: string) =>
  (await db.query<{ status: string }>("select status from turnering.tournaments where id = $1", [t])).rows[0].status;
const propagate = async (db: PGlite, id: string) =>
  (await db.query<{ finished: boolean; propagated: boolean }>("select * from turnering.propagate_playoff_result($1)", [id])).rows[0];
/** Avgjør en kamp (som en dommer ville gjort) og kjører videreføringen. */
async function decide(db: PGlite, id: string, side: "home" | "away") {
  const m = await row(db, id);
  await db.query("update turnering.matches set status = 'done', winner_team_id = $2, result_version = result_version + 1 where id = $1", [
    id,
    side === "home" ? m.home_team_id : m.away_team_id,
  ]);
  return propagate(db, id);
}

/** 4-lags cup med bronsefinale: to semifinaler → finale (slot 0) + bronse (slot 1). */
async function cupWithBronze(db: PGlite, withBronze = true) {
  const t = await tournament(db, "cup");
  const [a, b, c, d] = [await team(db, t, "A"), await team(db, t, "B"), await team(db, t, "C"), await team(db, t, "D")];
  const s1 = await match(db, t, { round: 1, slot: 0, home: a, away: d });
  const s2 = await match(db, t, { round: 1, slot: 1, home: b, away: c });
  const fin = await match(db, t, { round: 2, slot: 0 });
  await link(db, t, s1, fin, "home");
  await link(db, t, s2, fin, "away");
  let bronze: string | null = null;
  if (withBronze) {
    bronze = await match(db, t, { round: 2, slot: 1 });
    await link(db, t, s1, bronze, "home", "loser");
    await link(db, t, s2, bronze, "away", "loser");
  }
  return { t, s1, s2, fin, bronze, teams: { a, b, c, d } };
}

// ---------------------------------------------------------------------------

describe("0020 på fersk database (0001…0020)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await boot();
    for (const f of all) await db.exec(file(f));
    // Idempotent: 0020 på nytt skal ikke feile.
    await db.exec(file(named("0020")));
  });

  describe("B2 bronsefinale og finale", () => {
    it("bronse først, så finale: finalen avslutter turneringen", async () => {
      const x = await cupWithBronze(db);
      await decide(db, x.s1, "home");
      await decide(db, x.s2, "home");
      const br = await row(db, x.bronze!);
      expect([br.home_team_id, br.away_team_id]).toEqual([x.teams.d, x.teams.c]);

      expect((await decide(db, x.bronze!, "home")).finished).toBe(false);
      expect(await tStatus(db, x.t)).toBe("playoff");
      expect((await decide(db, x.fin, "home")).finished).toBe(true);
      expect(await tStatus(db, x.t)).toBe("finished");
    });

    it("finale først: turneringen står åpen til bronsefinalen er spilt", async () => {
      const x = await cupWithBronze(db);
      await decide(db, x.s1, "home");
      await decide(db, x.s2, "home");

      expect((await decide(db, x.fin, "home")).finished).toBe(false);
      expect(await tStatus(db, x.t)).toBe("playoff");
      // Bronsefinalen kan fortsatt registreres, og den som er ferdig sist avslutter.
      expect((await decide(db, x.bronze!, "away")).finished).toBe(true);
      expect(await tStatus(db, x.t)).toBe("finished");
    });

    it("uten bronsefinale: finalen avslutter som før", async () => {
      const x = await cupWithBronze(db, false);
      await decide(db, x.s1, "home");
      await decide(db, x.s2, "home");
      expect((await decide(db, x.fin, "home")).finished).toBe(true);
      expect(await tStatus(db, x.t)).toBe("finished");
    });

    it("bronsefinale som er 'bye' blokkerer ikke", async () => {
      const x = await cupWithBronze(db);
      await decide(db, x.s1, "home");
      await decide(db, x.s2, "home");
      await db.query("update turnering.matches set status = 'bye' where id = $1", [x.bronze]);
      expect((await decide(db, x.fin, "home")).finished).toBe(true);
    });

    it("gjentatt videreføring av finalen (replay) avslutter ikke for tidlig", async () => {
      const x = await cupWithBronze(db);
      await decide(db, x.s1, "home");
      await decide(db, x.s2, "home");
      await decide(db, x.fin, "home");
      const again = await propagate(db, x.fin);
      expect(again).toEqual({ finished: false, propagated: false });
      expect(await tStatus(db, x.t)).toBe("playoff");
    });

    it("B-finalen og bronsefinalen må begge være ferdige sammen med A-finalen", async () => {
      const x = await cupWithBronze(db);
      const [e, f] = [await team(db, x.t, "E"), await team(db, x.t, "F")];
      const bf = await match(db, x.t, { bracket: "B", round: 1, slot: 0, home: e, away: f });
      await decide(db, x.s1, "home");
      await decide(db, x.s2, "home");
      await decide(db, x.bronze!, "home");
      expect((await decide(db, x.fin, "home")).finished).toBe(false); // B-finalen mangler
      expect((await decide(db, bf, "home")).finished).toBe(true);
      expect(await tStatus(db, x.t)).toBe("finished");
    });

    it("bronsefinalen alene i et B-sluttspill (slot 1 med vei videre) teller ikke som bronse", async () => {
      // A-bane: finale uten bronse. B-bane: runde 1 slot 1 har vei videre til B-finalen.
      const t = await tournament(db, "league_playoff");
      const [a, b, c, d] = [await team(db, t, "A"), await team(db, t, "B"), await team(db, t, "C"), await team(db, t, "D")];
      const fin = await match(db, t, { round: 1, slot: 0, home: a, away: b });
      const b1 = await match(db, t, { bracket: "B", round: 1, slot: 0, home: c, away: d });
      const b2 = await match(db, t, { bracket: "B", round: 1, slot: 1 });
      const bfin = await match(db, t, { bracket: "B", round: 2, slot: 0 });
      await link(db, t, b1, bfin, "home");
      await link(db, t, b2, bfin, "away");
      expect((await decide(db, fin, "home")).finished).toBe(false); // B-finalen venter
      expect(await tStatus(db, t)).toBe("playoff");
    });

    it("dobbel utslag er uendret: W vinner storfinalen → ferdig, L vinner → omkamp", async () => {
      for (const lWins of [false, true]) {
        const t = await tournament(db, "double_elim");
        const [w, l] = [await team(db, t, "W"), await team(db, t, "L")];
        const gf1 = await match(db, t, { bracket: "GF", round: 1, slot: 0, home: w, away: l });
        const gf2 = await match(db, t, { bracket: "GF", round: 2, slot: 0, status: "scheduled" });
        await link(db, t, gf1, gf2, "home");
        await link(db, t, gf1, gf2, "away", "loser");
        const r = await decide(db, gf1, lWins ? "away" : "home");
        expect(r.finished).toBe(!lWins);
        expect(await tStatus(db, t)).toBe(lWins ? "playoff" : "finished");
        if (lWins) {
          expect((await decide(db, gf2, "home")).finished).toBe(true);
          expect(await tStatus(db, t)).toBe("finished");
        }
      }
    });
  });

  describe("A7 uncall_match gjenoppretter banen", () => {
    async function setup() {
      const t = await tournament(db, "league", "league");
      const [h, a] = [await team(db, t, "H"), await team(db, t, "A")];
      const m = await match(db, t, { phase: "league", home: h, away: a });
      const [c1, c2] = [await uid(db), await uid(db)];
      await db.query("insert into turnering.courts (id, tournament_id, name) values ($1, $3, 'B1'), ($2, $3, 'B2')", [c1, c2, t]);
      return { t, m, c1, c2 };
    }

    it("bane satt på forhånd: kall opp på en annen bane, angre → tilbake til første", async () => {
      const { m, c1, c2 } = await setup();
      await db.query("update turnering.matches set court_id = $2 where id = $1", [m, c1]);
      await db.query("select turnering.call_match($1, $2)", [m, c2]);
      let r = await row(db, m);
      expect([r.status, r.court_id, r.precall_court_id]).toEqual(["called", c2, c1]);
      await db.query("select turnering.uncall_match($1)", [m]);
      r = await row(db, m);
      expect([r.status, r.court_id, r.precall_court_id, r.called_at]).toEqual(["scheduled", c1, null, null]);
    });

    it("kamp uten bane: angre gir ingen bane (null), ikke oppkallingsbanen", async () => {
      const { m, c2 } = await setup();
      await db.query("select turnering.call_match($1, $2)", [m, c2]);
      await db.query("select turnering.uncall_match($1)", [m]);
      const r = await row(db, m);
      expect([r.status, r.court_id, r.precall_court_id]).toEqual(["scheduled", null, null]);
    });

    it("oppkalling to ganger overskriver ikke den opprinnelige banen", async () => {
      const { m, c1, c2 } = await setup();
      await db.query("update turnering.matches set court_id = $2 where id = $1", [m, c1]);
      await db.query("select turnering.call_match($1, $2)", [m, c2]);
      await expect(db.query("select turnering.call_match($1, $2)", [m, c1])).rejects.toThrow(/match_not_callable/);
      expect((await row(db, m)).precall_court_id).toBe(c1);
      await db.query("select turnering.uncall_match($1)", [m]);
      expect((await row(db, m)).court_id).toBe(c1);
    });

    it("kall opp → angre → kall opp på nytt → angre fungerer hver gang", async () => {
      const { m, c1, c2 } = await setup();
      await db.query("update turnering.matches set court_id = $2 where id = $1", [m, c1]);
      for (let i = 0; i < 2; i++) {
        await db.query("select turnering.call_match($1, $2)", [m, c2]);
        await db.query("select turnering.uncall_match($1)", [m]);
        expect((await row(db, m)).court_id).toBe(c1);
      }
    });
  });

  describe("C7 lagbytte utdaterer køet resultat", () => {
    const submit = (m: string, version: number, winner: string, req: string) =>
      db.query("select turnering.submit_match_result($1, $2, $3::jsonb, $4, 'done', null, $5)", [
        m,
        version,
        JSON.stringify({ home: 1, away: 0 }),
        winner,
        req,
      ]);

    it("byttet lag i en kamp øker versjonen; utdatert innsending avvises med version_conflict", async () => {
      const t = await tournament(db, "cup");
      const [h, a, z] = [await team(db, t, "H"), await team(db, t, "A"), await team(db, t, "Z")];
      const m = await match(db, t, { home: h, away: a, status: "live" });
      const seen = (await row(db, m)).result_version as number;

      await db.query("update turnering.matches set home_team_id = $2 where id = $1", [m, z]);
      const after = (await row(db, m)).result_version as number;
      expect(after).toBe(seen + 1);

      await expect(submit(m, seen, h, await uid(db))).rejects.toThrow(/version_conflict/);
      const r = await row(db, m);
      expect([r.status, r.winner_team_id]).toEqual(["live", null]); // ingenting skrevet
      // Med den nye versjonen går det gjennom.
      await submit(m, after, z, await uid(db));
      expect((await row(db, m)).winner_team_id).toBe(z);
    });

    it("bortelaget byttet eller tømt øker også versjonen", async () => {
      const t = await tournament(db, "cup");
      const [h, a, z] = [await team(db, t, "H"), await team(db, t, "A"), await team(db, t, "Z")];
      const m = await match(db, t, { home: h, away: a });
      const v0 = (await row(db, m)).result_version as number;
      await db.query("update turnering.matches set away_team_id = $2 where id = $1", [m, z]);
      await db.query("update turnering.matches set away_team_id = null where id = $1", [m]);
      expect((await row(db, m)).result_version).toBe(v0 + 2);
    });

    it("tom plass som fylles, samme lag skrevet på nytt og andre kolonner endrer ikke versjonen", async () => {
      const t = await tournament(db, "cup");
      const [h, a] = [await team(db, t, "H"), await team(db, t, "A")];
      const m = await match(db, t, { home: h, away: null });
      const v0 = (await row(db, m)).result_version as number;
      await db.query("update turnering.matches set away_team_id = $2 where id = $1", [m, a]);
      await db.query("update turnering.matches set away_team_id = $2, home_team_id = $3 where id = $1", [m, a, h]);
      await db.query("update turnering.matches set status = 'live' where id = $1", [m]);
      expect((await row(db, m)).result_version).toBe(v0);
    });

    it("samme UPDATE som alt øker versjonen gir bare ett steg", async () => {
      const t = await tournament(db, "cup");
      const [h, a, z] = [await team(db, t, "H"), await team(db, t, "A"), await team(db, t, "Z")];
      const m = await match(db, t, { home: h, away: a });
      const v0 = (await row(db, m)).result_version as number;
      await db.query("update turnering.matches set home_team_id = $2, result_version = result_version + 1 where id = $1", [m, z]);
      expect((await row(db, m)).result_version).toBe(v0 + 1);
    });

    it("overstyring som snur en semifinale bumper finalens versjon (videreføring bytter plass)", async () => {
      const x = await cupWithBronze(db);
      await decide(db, x.s1, "home");
      await decide(db, x.s2, "home");
      const finalSeen = (await row(db, x.fin)).result_version as number;
      // Organisatoren snur semifinale 1: bortelaget (D) vant likevel.
      await db.query("select turnering.override_match_result($1, $2::jsonb, 'away', true)", [x.s1, JSON.stringify({ home: 0, away: 1 })]);
      const fin = await row(db, x.fin);
      expect(fin.home_team_id).toBe(x.teams.d);
      expect(fin.result_version as number).toBeGreaterThan(finalSeen);
      // Et resultat som ble sendt mot gammel versjon (A mot B, A vinner) avvises.
      await expect(submit(x.fin, finalSeen, x.teams.a, await uid(db))).rejects.toThrow(/version_conflict/);
    });

    it("gjenåpnet sluttspill: nullstilt plass (lag → null) øker versjonen på kampen", async () => {
      const x = await cupWithBronze(db);
      await decide(db, x.s1, "home");
      await decide(db, x.s2, "home");
      await decide(db, x.fin, "home");
      const finSeen = (await row(db, x.fin)).result_version as number;
      await db.query("select turnering.override_match_result($1, $2::jsonb, 'away', true)", [x.s2, JSON.stringify({ home: 0, away: 1 })]);
      const fin = await row(db, x.fin);
      expect(fin.status).toBe("scheduled");
      expect(fin.result_version as number).toBeGreaterThan(finSeen);
    });
  });

  it("etterkontrollen i docs/DEPLOY-MIGRATION-0020.md er gyldig og helt grønn", async () => {
    const md = readFileSync(join(__dirname, "..", "docs", "DEPLOY-MIGRATION-0020.md"), "utf8");
    const sql = /```sql\n([\s\S]*?)```/.exec(md)![1];
    const r = await db.query<{ sjekk: string; ok: boolean | null }>(sql);
    expect(r.rows).toHaveLength(4);
    expect(r.rows.filter((x) => x.ok !== true)).toEqual([]);
  });

  it("trigger-funksjonen er låst (ingen execute for anon/authenticated)", async () => {
    const r = await db.query<{ anon: boolean; pub: boolean; cfg: string[] | null }>(
      `select has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as pub,
              p.proconfig as cfg
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'turnering' and p.proname = 'matches_team_change_bump_version'`,
    );
    expect([r.rows[0].anon, r.rows[0].pub]).toEqual([false, false]);
    expect(r.rows[0].cfg).toContain('search_path=""');
  });
});

describe("0020 oppå en database som bare har 0001…0019 (data finnes fra før)", () => {
  it("kjører rent og beholder eksisterende rader", async () => {
    const db = await boot();
    for (const f of all.filter((f) => f < "0020")) await db.exec(file(f));
    const x = await cupWithBronze(db);
    await db.exec(file(named("0020")));
    await decide(db, x.s1, "home");
    await decide(db, x.s2, "home");
    expect((await decide(db, x.fin, "home")).finished).toBe(false);
    expect((await decide(db, x.bronze!, "home")).finished).toBe(true);
  });

  it("før 0020 avslutter finalen turneringen selv om bronsefinalen står igjen (feilen som rettes)", async () => {
    const db = await boot();
    for (const f of all.filter((f) => f < "0020")) await db.exec(file(f));
    const x = await cupWithBronze(db);
    await decide(db, x.s1, "home");
    await decide(db, x.s2, "home");
    expect((await decide(db, x.fin, "home")).finished).toBe(true);
  });
});
