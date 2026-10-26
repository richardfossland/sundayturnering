import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// Migrasjon 0018 (format 'swiss') mot en ekte Postgres i minnet: hele 0001…0018
// kjøres, så testes format-CHECK-en og at en Swiss-turnering kan lagres og leses.

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");

let db: PGlite;

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
  expect(files.at(-1)).toBe("0020_bronze_uncall_stale_queue.sql");
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  // Idempotent: 0018 på nytt skal ikke feile.
  await db.exec(readFileSync(join(MIGRATIONS, "0018_swiss.sql"), "utf8"));
});

describe("0018 format", () => {
  it("godtar swiss (med config.swiss.rounds) og beholder de andre formatene", async () => {
    const formats = ["league", "league_playoff", "cup", "group_playoff", "double_elim", "swiss"];
    for (const [i, f] of formats.entries()) {
      await db.query(
        `insert into turnering.tournaments (control_code, board_code, organiser_code, format, config)
         values ($1, 'b', 'o', $2, $3::jsonb)`,
        [`50000${i}`, f, JSON.stringify(f === "swiss" ? { swiss: { rounds: 4 } } : {})],
      );
    }
    const r = await db.query<{ format: string; rounds: string | null }>(
      "select format, config->'swiss'->>'rounds' as rounds from turnering.tournaments where format = 'swiss'",
    );
    expect(r.rows).toEqual([{ format: "swiss", rounds: "4" }]);
  });

  it("avviser ukjent format", async () => {
    await expect(
      db.query(
        `insert into turnering.tournaments (control_code, board_code, organiser_code, format)
         values ('600000', 'b', 'o', 'bogus')`,
      ),
    ).rejects.toThrow();
  });
});
