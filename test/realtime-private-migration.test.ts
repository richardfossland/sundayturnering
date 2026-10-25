import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// Applies every migration (0001…0013) to an in-memory Postgres with a stubbed
// Supabase `realtime` schema, then replays what Realtime does at join time: a
// SELECT / INSERT on realtime.messages AS the subscriber's role with
// realtime.topic() set to the channel topic. The stub mirrors the real shape
// (topic() reads a setting; messages has topic + extension) — enough to prove
// the allow/deny matrix of 0011's policies.

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");
const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555"; // no such tournament

let db: PGlite;

async function asAnon<T>(topic: string, fn: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    await db.query("select set_config('realtime.topic', $1, true)", [topic]);
    await db.exec("set local role anon");
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}

async function canRead(topic: string): Promise<boolean> {
  return asAnon(topic, async () => {
    const r = await db.query<{ n: number }>(
      "select count(*)::int as n from realtime.messages where topic = $1",
      [topic],
    );
    return r.rows[0].n > 0;
  });
}

async function canSend(topic: string, extension: "broadcast" | "presence"): Promise<boolean> {
  return asAnon(topic, async () => {
    try {
      await db.query(
        "insert into realtime.messages (topic, extension, payload) values ($1, $2, '{}')",
        [topic, extension],
      );
      return true;
    } catch (e) {
      if (/row-level security/i.test(String(e))) return false;
      throw e;
    }
  });
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
      topic text not null,
      extension text not null,
      payload jsonb,
      event text,
      private boolean default true
    );
    alter table realtime.messages enable row level security;
    grant execute on function realtime.topic() to anon, authenticated;
    -- 0001 seeds a logo bucket; stub just enough of Supabase storage for it.
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
  `);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  expect(files.at(-1)).toBe("0013_shift_schedule.sql");
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  // Re-applying must be a no-op (idempotent).
  await db.exec(readFileSync(join(MIGRATIONS, "0011_realtime_private.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0012_schedule.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0013_shift_schedule.sql"), "utf8"));

  await db.query(
    `insert into turnering.tournaments (id, control_code, board_code, organiser_code, format)
     values ($1, '123456', 'b', 'o', 'cup')`,
    [ID],
  );
  // One row per topic so the receive probe has something to see.
  for (const t of [`t:${ID}`, `t:${ID}:cheer`, `t:${ID}:presence`, `t:${OTHER}`, "x:other-app"]) {
    await db.query("insert into realtime.messages (topic, extension) values ($1, 'broadcast')", [t]);
  }
});

describe("0011 realtime private channels", () => {
  it("anon receives on all three topics of an existing tournament", async () => {
    expect(await canRead(`t:${ID}`)).toBe(true);
    expect(await canRead(`t:${ID}:cheer`)).toBe(true);
    expect(await canRead(`t:${ID}:presence`)).toBe(true);
  });

  it("anon cannot receive for unknown tournaments or foreign topics", async () => {
    expect(await canRead(`t:${OTHER}`)).toBe(false);
    expect(await canRead("x:other-app")).toBe(false);
  });

  it("anon cannot send server hints on the bare tournament topic", async () => {
    expect(await canSend(`t:${ID}`, "broadcast")).toBe(false);
    expect(await canSend(`t:${ID}`, "presence")).toBe(false);
  });

  it("anon can send cheers and track presence, each only on its own topic", async () => {
    expect(await canSend(`t:${ID}:cheer`, "broadcast")).toBe(true);
    expect(await canSend(`t:${ID}:presence`, "presence")).toBe(true);
    expect(await canSend(`t:${ID}:cheer`, "presence")).toBe(false);
    expect(await canSend(`t:${ID}:presence`, "broadcast")).toBe(false);
  });

  it("anon cannot send for unknown tournaments or junk topics", async () => {
    expect(await canSend(`t:${OTHER}:cheer`, "broadcast")).toBe(false);
    expect(await canSend("t:not-a-uuid:cheer", "broadcast")).toBe(false);
    expect(await canSend(`t:${ID}:cheer:extra`, "broadcast")).toBe(false);
  });

  it("rt_topic_ok rejects junk without erroring", async () => {
    const r = await db.query<{ ok: boolean }>(
      "select turnering.rt_topic_ok($1) as ok",
      ["t:zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"],
    );
    expect(r.rows[0].ok).toBe(false);
  });
});

describe("0012 schedule", () => {
  it("adds a nullable matches.scheduled_at timestamptz", async () => {
    const r = await db.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
       where table_schema = 'turnering' and table_name = 'matches' and column_name = 'scheduled_at'`,
    );
    expect(r.rows).toEqual([{ data_type: "timestamp with time zone", is_nullable: "YES" }]);
  });
});

describe("0013 shift_schedule", () => {
  const T = "aaaaaaaa-2222-4333-8444-555555555555";
  const C1 = "c1111111-2222-4333-8444-555555555555";
  const C2 = "c2222222-2222-4333-8444-555555555555";
  const iso = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

  const sched = async (): Promise<Record<string, number | null>> => {
    const r = await db.query<{ id: string; ms: string | null }>(
      `select substr(id::text, 1, 1) as id,
              (extract(epoch from scheduled_at) * 1000)::bigint::text as ms
         from turnering.matches where tournament_id = $1`,
      [T],
    );
    return Object.fromEntries(r.rows.map((x) => [x.id, x.ms === null ? null : Number(x.ms)]));
  };
  const shift = (court: string | null, from: string, minutes: number) =>
    db.query<{ n: number }>("select turnering.shift_schedule($1, $2, $3, $4) as n", [
      T,
      court,
      from,
      minutes,
    ]);
  const version = async () =>
    (await db.query<{ v: number }>("select version as v from turnering.tournaments where id = $1", [T]))
      .rows[0].v;

  beforeAll(async () => {
    await db.query(
      `insert into turnering.tournaments (id, control_code, board_code, organiser_code, format)
       values ($1, '654321', 'b2', 'o2', 'cup')`,
      [T],
    );
    for (const [id, name] of [[C1, "Bane 1"], [C2, "Bane 2"]])
      await db.query("insert into turnering.courts (id, tournament_id, name) values ($1, $2, $3)", [id, T, name]);
    const rows: [string, string | null, string, number | null][] = [
      ["a", C1, "scheduled", 10],
      ["b", C2, "scheduled", 20],
      ["c", C1, "live", 30],
      ["d", C1, "done", 40],
      ["e", C1, "bye", 50],
      ["f", C1, "scheduled", null],
      ["1", C1, "scheduled", 5], // before p_from below
    ];
    for (const [p, court, status, min] of rows)
      await db.query(
        `insert into turnering.matches (id, tournament_id, court_id, status, scheduled_at)
         values ($1, $2, $3, $4, $5)`,
        [`${p}0000000-2222-4333-8444-555555555555`, T, court, status, min === null ? null : iso(min)],
      );
  });

  it("shifts only the chosen court's open, timed matches from p_from and bumps the version", async () => {
    const before = await sched();
    const v0 = await version();
    const r = await shift(C1, iso(8), 15);
    expect(r.rows[0].n).toBe(2); // a (10) and c (30, live); not 1 (before from), not done/bye/untimed
    const after = await sched();
    expect(after.a! - before.a!).toBe(15 * 60_000);
    expect(after.c! - before.c!).toBe(15 * 60_000);
    for (const k of ["b", "d", "e", "f", "1"]) expect(after[k]).toBe(before[k]);
    expect(await version()).toBe(v0 + 1);
  });

  it("all courts when p_court is null; negative shift allowed", async () => {
    const before = await sched();
    const r = await shift(null, iso(8), -5);
    expect(r.rows[0].n).toBe(3); // a, b, c
    const after = await sched();
    expect(before.b! - after.b!).toBe(5 * 60_000);
    expect(before.a! - after.a!).toBe(5 * 60_000);
  });

  it("refuses a shift that would land before now, and writes nothing", async () => {
    const before = await sched();
    const v0 = await version();
    await expect(shift(null, iso(8), -60)).rejects.toThrow(/shift_in_past/);
    expect(await sched()).toEqual(before);
    expect(await version()).toBe(v0);
  });

  it("refuses |minutes| > 240 and 0", async () => {
    await expect(shift(null, iso(0), 241)).rejects.toThrow(/shift_too_large/);
    await expect(shift(null, iso(0), -241)).rejects.toThrow(/shift_too_large/);
    await expect(shift(null, iso(0), 0)).rejects.toThrow(/shift_zero/);
  });

  it("returns 0 and leaves the version when nothing matches", async () => {
    const v0 = await version();
    expect((await shift(null, iso(1000), 5)).rows[0].n).toBe(0);
    expect(await version()).toBe(v0);
  });

  it("is executable by service_role only", async () => {
    const r = await db.query<{ a: boolean; s: boolean }>(
      `select has_function_privilege('anon', 'turnering.shift_schedule(uuid,uuid,timestamptz,int)', 'execute') as a,
              has_function_privilege('service_role', 'turnering.shift_schedule(uuid,uuid,timestamptz,int)', 'execute') as s`,
    );
    expect(r.rows[0]).toEqual({ a: false, s: true });
  });
});
