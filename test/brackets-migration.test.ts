import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// Migrasjon 0016 (matches.bracket + propagate_playoff_result for flere
// braketter) mot en ekte Postgres i minnet: alle migrasjoner 0001…0016 kjøres,
// så spilles en cup med trøsterunde gjennom RPC-en.

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");

let db: PGlite;

async function uid(): Promise<string> {
  const r = await db.query<{ id: string }>("select gen_random_uuid()::text as id");
  return r.rows[0].id;
}

/** Cup med 4 lag: A = to semifinaler + finale, B = ÉN trøstefinale mellom semifinaletaperne
 * (en liten trøsterunde er nok til å teste koblinger og avslutning). */
async function seedCup() {
  const t = await uid();
  await db.query(
    `insert into turnering.tournaments (id, control_code, board_code, organiser_code, format, status)
     values ($1, $2, 'b', 'o', 'cup', 'playoff')`,
    [t, String(Math.floor(Math.random() * 900000) + 100000)],
  );
  const teams: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = await uid();
    teams.push(id);
    await db.query("insert into turnering.teams (id, tournament_id, name) values ($1, $2, $3)", [id, t, `L${i}`]);
  }
  const m = { s1: await uid(), s2: await uid(), af: await uid(), bf: await uid() };
  const ins = (id: string, round: number, slot: number, bracket: string, home: string | null, away: string | null) =>
    db.query(
      `insert into turnering.matches (id, tournament_id, phase, round, bracket_slot, bracket, home_team_id, away_team_id)
       values ($1, $2, 'playoff', $3, $4, $5, $6, $7)`,
      [id, t, round, slot, bracket, home, away],
    );
  await ins(m.s1, 1, 0, "A", teams[0], teams[1]);
  await ins(m.s2, 1, 1, "A", teams[2], teams[3]);
  await ins(m.af, 2, 0, "A", null, null);
  await ins(m.bf, 1, 0, "B", null, null);
  const link = (from: string, to: string, slot: string, feed: string) =>
    db.query(
      `insert into turnering.bracket_links (tournament_id, from_match_id, to_match_id, to_slot, feed)
       values ($1, $2, $3, $4, $5)`,
      [t, from, to, slot, feed],
    );
  await link(m.s1, m.af, "home", "winner");
  await link(m.s2, m.af, "away", "winner");
  await link(m.s1, m.bf, "home", "loser");
  await link(m.s2, m.bf, "away", "loser");
  return { t, teams, m };
}

async function finish(matchId: string, winner: string) {
  await db.query(
    "update turnering.matches set status = 'done', winner_team_id = $2, result_version = result_version + 1 where id = $1",
    [matchId, winner],
  );
  const r = await db.query<{ finished: boolean; propagated: boolean }>(
    "select * from turnering.propagate_playoff_result($1)",
    [matchId],
  );
  return r.rows[0];
}

async function statusOf(t: string): Promise<string> {
  const r = await db.query<{ status: string }>("select status from turnering.tournaments where id = $1", [t]);
  return r.rows[0].status;
}

beforeAll(async () => {
  db = new PGlite();
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
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  expect(files.at(-1)).toBe("0016_brackets.sql");
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  // Idempotent: kjøres 0016 på nytt skal ingenting feile.
  await db.exec(readFileSync(join(MIGRATIONS, "0016_brackets.sql"), "utf8"));
});

describe("0016 matches.bracket", () => {
  it("eksisterende rader blir 'A'; B, W, L, GF er tillatt; alt annet avvises", async () => {
    const { t } = await seedCup();
    const r = await db.query<{ bracket: string }>(
      "select distinct bracket from turnering.matches where tournament_id = $1 order by 1",
      [t],
    );
    expect(r.rows.map((x) => x.bracket)).toEqual(["A", "B"]);

    const dflt = await uid();
    await db.query("insert into turnering.matches (id, tournament_id) values ($1, $2)", [dflt, t]);
    const d = await db.query<{ bracket: string }>("select bracket from turnering.matches where id = $1", [dflt]);
    expect(d.rows[0].bracket).toBe("A");

    for (const b of ["W", "L", "GF"])
      await db.query("insert into turnering.matches (id, tournament_id, bracket) values (gen_random_uuid(), $1, $2)", [t, b]);
    await expect(
      db.query("insert into turnering.matches (id, tournament_id, bracket) values (gen_random_uuid(), $1, 'X')", [t]),
    ).rejects.toThrow();
  });
});

describe("propagate_playoff_result med to braketter", () => {
  it("taperen av semifinalen havner i B-finalen (feed=loser) og vinneren i A-finalen", async () => {
    const { t, teams, m } = await seedCup();
    const r = await finish(m.s1, teams[0]);
    expect(r).toEqual({ finished: false, propagated: true });
    const af = await db.query<{ home_team_id: string }>("select home_team_id from turnering.matches where id = $1", [m.af]);
    const bf = await db.query<{ home_team_id: string }>("select home_team_id from turnering.matches where id = $1", [m.bf]);
    expect(af.rows[0].home_team_id).toBe(teams[0]);
    expect(bf.rows[0].home_team_id).toBe(teams[1]);
    expect(await statusOf(t)).toBe("playoff");
  });

  it("A-finalen først: turneringen er IKKE ferdig før B-finalen er spilt", async () => {
    const { t, teams, m } = await seedCup();
    await finish(m.s1, teams[0]);
    await finish(m.s2, teams[2]);
    expect(await finish(m.af, teams[0])).toMatchObject({ finished: false });
    expect(await statusOf(t)).toBe("playoff");
    expect(await finish(m.bf, teams[3])).toMatchObject({ finished: true });
    expect(await statusOf(t)).toBe("finished");
  });

  it("B-finalen først: A-finalen avslutter", async () => {
    const { t, teams, m } = await seedCup();
    await finish(m.s1, teams[0]);
    await finish(m.s2, teams[2]);
    expect(await finish(m.bf, teams[1])).toMatchObject({ finished: false });
    expect(await statusOf(t)).toBe("playoff");
    expect(await finish(m.af, teams[2])).toMatchObject({ finished: true });
    expect(await statusOf(t)).toBe("finished");
  });

  it("gjentatt kall for samme resultat er fortsatt et no-op", async () => {
    const { teams, m } = await seedCup();
    await finish(m.s1, teams[0]);
    const again = await db.query<{ finished: boolean; propagated: boolean }>(
      "select * from turnering.propagate_playoff_result($1)",
      [m.s1],
    );
    expect(again.rows[0]).toEqual({ finished: false, propagated: false });
  });

  it("uten B (kun A) avslutter A-finalen som før", async () => {
    const t = await uid();
    await db.query(
      `insert into turnering.tournaments (id, control_code, board_code, organiser_code, format, status)
       values ($1, '654321', 'b', 'o', 'cup', 'playoff')`,
      [t],
    );
    const a = await uid();
    const home = await uid();
    await db.query("insert into turnering.teams (id, tournament_id, name) values ($1, $2, 'x')", [home, t]);
    await db.query(
      `insert into turnering.matches (id, tournament_id, phase, round, bracket_slot, home_team_id)
       values ($1, $2, 'playoff', 1, 0, $3)`,
      [a, t, home],
    );
    expect(await finish(a, home)).toMatchObject({ finished: true });
    expect(await statusOf(t)).toBe("finished");
  });
});
