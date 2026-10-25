import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// Applies every migration (0001…0015) to an in-memory Postgres with a stubbed
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
  expect(files.at(-1)).toBe("0015_idempotent_result.sql");
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  // Re-applying must be a no-op (idempotent).
  await db.exec(readFileSync(join(MIGRATIONS, "0011_realtime_private.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0012_schedule.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0013_shift_schedule.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0014_called.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0015_idempotent_result.sql"), "utf8"));

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
      ["c", C1, "scheduled", 30],
      ["9", C1, "live", 35],
      ["d", C1, "done", 40],
      ["e", C1, "bye", 50],
      ["f", C1, "scheduled", null],
      ["1", C1, "scheduled", 5], // before p_from below
    ];
    for (const [p, court, status, min] of rows)
      await db.query(
        `insert into turnering.matches (id, tournament_id, court_id, status, scheduled_at)
         values ($1, $2, $3, $4, $5)`,
        [`${p.padEnd(1)}0000000-2222-4333-8444-555555555555`, T, court, status, min === null ? null : iso(min)],
      );
  });

  it("shifts only the chosen court's open, timed matches from p_from and bumps the version", async () => {
    const before = await sched();
    const v0 = await version();
    const r = await shift(C1, iso(8), 15);
    expect(r.rows[0].n).toBe(2); // a (10) and c (30); not 1 (before from), not live/done/bye/untimed
    const after = await sched();
    expect(after.a! - before.a!).toBe(15 * 60_000);
    expect(after.c! - before.c!).toBe(15 * 60_000);
    for (const k of ["b", "d", "e", "f", "1", "9"]) expect(after[k]).toBe(before[k]);
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

  it("includes overdue matches from the epoch; positive shift may stay in the past, negative may not", async () => {
    await db.query(
      `insert into turnering.matches (id, tournament_id, court_id, status, scheduled_at)
       values ('20000000-2222-4333-8444-555555555555', $1, $2, 'scheduled', $3)`,
      [T, C1, iso(-30)],
    );
    const epoch = new Date(0).toISOString();
    const before = await sched();
    await expect(shift(null, epoch, -5)).rejects.toThrow(/shift_in_past/);
    expect(await sched()).toEqual(before);
    const r = await shift(null, epoch, 10);
    expect(r.rows[0].n).toBeGreaterThanOrEqual(4);
    const after = await sched();
    expect(after["2"]! - before["2"]!).toBe(10 * 60_000); // still overdue, allowed
    expect(after["9"]).toBe(before["9"]); // live untouched
  });

  it("is executable by service_role only", async () => {
    const r = await db.query<{ a: boolean; s: boolean }>(
      `select has_function_privilege('anon', 'turnering.shift_schedule(uuid,uuid,timestamptz,int)', 'execute') as a,
              has_function_privilege('service_role', 'turnering.shift_schedule(uuid,uuid,timestamptz,int)', 'execute') as s`,
    );
    expect(r.rows[0]).toEqual({ a: false, s: true });
  });
});

describe("0014 call_match / uncall_match", () => {
  const T = "bbbbbbbb-2222-4333-8444-555555555555";
  const C1 = "c1111111-3333-4333-8444-555555555555";
  const C2 = "c2222222-3333-4333-8444-555555555555";
  const OTHER_COURT = "c3333333-3333-4333-8444-555555555555";
  const T2 = "bbbbbbbb-9999-4333-8444-555555555555";
  const TEAMS = ["1", "2", "3", "4", "5", "6"].map((n) => `${n}1111111-3333-4333-8444-555555555555`);
  const mid = (p: string) => `${p}0000000-3333-4333-8444-555555555555`;

  const call = (match: string, court: string) =>
    db.query("select (turnering.call_match($1, $2)).status as s", [match, court]);
  const uncall = (match: string) =>
    db.query("select (turnering.uncall_match($1)).status as s", [match]);
  const row = async (p: string) =>
    (
      await db.query<{ status: string; court_id: string | null; called_at: string | null }>(
        "select status, court_id, called_at from turnering.matches where id = $1",
        [mid(p)],
      )
    ).rows[0];
  const version = async () =>
    (await db.query<{ v: number }>("select version as v from turnering.tournaments where id = $1", [T]))
      .rows[0].v;

  beforeAll(async () => {
    for (const [id, code] of [[T, "111111"], [T2, "222222"]])
      await db.query(
        `insert into turnering.tournaments (id, control_code, board_code, organiser_code, format)
         values ($1, $2, $2, $2, 'cup')`,
        [id, code],
      );
    for (const [id, tid] of [[C1, T], [C2, T], [OTHER_COURT, T2]])
      await db.query("insert into turnering.courts (id, tournament_id, name) values ($1, $2, 'B')", [id, tid]);
    for (const [i, id] of TEAMS.entries())
      await db.query("insert into turnering.teams (id, tournament_id, name) values ($1, $2, $3)", [id, T, `L${i}`]);
    const rows: [string, string, string | null, string | null][] = [
      ["a", "scheduled", TEAMS[0], TEAMS[1]],
      ["b", "scheduled", TEAMS[2], TEAMS[3]],
      ["c", "scheduled", TEAMS[4], null], // TBD
      ["d", "live", TEAMS[4], TEAMS[5]],
      ["e", "done", TEAMS[0], TEAMS[2]],
    ];
    for (const [p, status, h, a] of rows)
      await db.query(
        `insert into turnering.matches (id, tournament_id, status, home_team_id, away_team_id)
         values ($1, $2, $3, $4, $5)`,
        [mid(p), T, status, h, a],
      );
  });

  it("the status check accepts 'called' and still refuses junk", async () => {
    await expect(
      db.query("update turnering.matches set status = 'nope' where id = $1", [mid("a")]),
    ).rejects.toThrow();
  });

  it("calls a scheduled match: status, court, called_at, version bump", async () => {
    const v0 = await version();
    expect((await call(mid("a"), C1)).rows[0]).toEqual({ s: "called" });
    const r = await row("a");
    expect(r.court_id).toBe(C1);
    expect(r.called_at).not.toBeNull();
    expect(await version()).toBe(v0 + 1);
  });

  it("refuses a second match on the same court (called) and on a court with a live match", async () => {
    await expect(call(mid("b"), C1)).rejects.toThrow(/court_busy/);
    await db.query("update turnering.matches set court_id = $2 where id = $1", [mid("d"), C2]);
    await expect(call(mid("b"), C2)).rejects.toThrow(/court_busy/);
    expect((await row("b")).status).toBe("scheduled");
  });

  it("refuses non-scheduled / TBD matches, and a court from another tournament", async () => {
    await expect(call(mid("c"), C1)).rejects.toThrow(/match_not_callable|court_busy/);
    await expect(call(mid("e"), C1)).rejects.toThrow(/match_not_callable|court_busy/);
    await expect(call(mid("a"), C2)).rejects.toThrow(/match_not_callable|court_busy/); // already called
    await expect(call(mid("b"), OTHER_COURT)).rejects.toThrow(/court_not_found/);
  });

  it("un-calls only a called match, clearing called_at; version bumps", async () => {
    const v0 = await version();
    expect((await uncall(mid("a"))).rows[0]).toEqual({ s: "scheduled" });
    expect((await row("a")).called_at).toBeNull();
    expect(await version()).toBe(v0 + 1);
    await expect(uncall(mid("a"))).rejects.toThrow(/match_not_callable/);
    await expect(uncall(mid("d"))).rejects.toThrow(/match_not_callable/);
  });

  it("a called match can be started (→ live) and have its result submitted", async () => {
    await call(mid("a"), C1);
    await db.query("update turnering.matches set status = 'live' where id = $1 and status = 'called'", [mid("a")]);
    expect((await row("a")).status).toBe("live");
    await expect(call(mid("b"), C1)).rejects.toThrow(/court_busy/); // C1 now has a live match
    const r = await db.query<{ s: string }>(
      "select (turnering.submit_match_result($1, 0, '{\"home\":1,\"away\":0}'::jsonb, $2, 'done', 'dev')).status as s",
      [mid("a"), TEAMS[0]],
    );
    expect(r.rows[0].s).toBe("done");
    // The RPC does not look at the previous status: a called (never started)
    // match accepts a result too.
    await call(mid("b"), C1);
    const r2 = await db.query<{ s: string }>(
      "select (turnering.submit_match_result($1, 0, '{\"home\":0,\"away\":1}'::jsonb, $2, 'done', 'dev')).status as s",
      [mid("b"), TEAMS[3]],
    );
    expect(r2.rows[0].s).toBe("done");
  });

  it("shift_schedule still shifts a called match", async () => {
    await db.query("update turnering.matches set status = 'called', scheduled_at = now() + interval '10 minutes' where id = $1", [mid("c")]);
    const before = (await db.query<{ t: string }>("select scheduled_at::text as t from turnering.matches where id = $1", [mid("c")])).rows[0].t;
    await db.query("select turnering.shift_schedule($1, null, now(), 5)", [T]);
    const after = (await db.query<{ t: string }>("select scheduled_at::text as t from turnering.matches where id = $1", [mid("c")])).rows[0].t;
    expect(after).not.toBe(before);
  });

  it("is executable by service_role only and re-applying is a no-op", async () => {
    const r = await db.query<{ a: boolean; s: boolean; u: boolean }>(
      `select has_function_privilege('anon', 'turnering.call_match(uuid,uuid)', 'execute') as a,
              has_function_privilege('service_role', 'turnering.call_match(uuid,uuid)', 'execute') as s,
              has_function_privilege('service_role', 'turnering.uncall_match(uuid)', 'execute') as u`,
    );
    expect(r.rows[0]).toEqual({ a: false, s: true, u: true });
    await db.exec(readFileSync(join(MIGRATIONS, "0014_called.sql"), "utf8"));
  });
});

describe("0015 idempotent submit_match_result", () => {
  const T = "dddddddd-2222-4333-8444-555555555555";
  const M1 = "d1000000-2222-4333-8444-555555555555";
  const M2 = "d2000000-2222-4333-8444-555555555555";
  const W = "d3000000-2222-4333-8444-555555555555";
  const REQ = "e1000000-2222-4333-8444-555555555555";
  const REQ2 = "e2000000-2222-4333-8444-555555555555";
  const REQ3 = "e3000000-2222-4333-8444-555555555555";

  const submit = (match: string, version: number, req: string | null, home = 1) =>
    req
      ? db.query<{ v: number; s: string }>(
          `select (r).result_version as v, (r).status as s from
             (select turnering.submit_match_result($1, $2, $3::jsonb, $4, 'done', 'dev', $5) as r) x`,
          [match, version, JSON.stringify({ home, away: 0 }), W, req],
        )
      : db.query<{ v: number; s: string }>(
          `select (r).result_version as v, (r).status as s from
             (select turnering.submit_match_result($1, $2, $3::jsonb, $4, 'done', 'dev') as r) x`,
          [match, version, JSON.stringify({ home, away: 0 }), W],
        );
  const ver = async (match: string) =>
    (await db.query<{ v: number }>("select result_version as v from turnering.matches where id = $1", [match]))
      .rows[0].v;

  beforeAll(async () => {
    await db.query(
      `insert into turnering.tournaments (id, control_code, board_code, organiser_code, format)
       values ($1, '777777', 'b7', 'o7', 'cup')`,
      [T],
    );
    await db.query("insert into turnering.teams (id, tournament_id, name) values ($1, $2, 'W')", [W, T]);
    for (const id of [M1, M2])
      await db.query("insert into turnering.matches (id, tournament_id) values ($1, $2)", [id, T]);
  });

  it("a repeated request id commits once and returns the same outcome", async () => {
    const first = await submit(M1, 0, REQ);
    expect(first.rows[0]).toEqual({ v: 1, s: "done" });
    const again = await submit(M1, 0, REQ); // same stale expected version: no 409
    expect(again.rows[0]).toEqual({ v: 1, s: "done" });
    const third = await submit(M1, 1, REQ, 5); // even if the payload differs
    expect(third.rows[0]).toEqual({ v: 1, s: "done" });
    expect(await ver(M1)).toBe(1);
    const n = await db.query<{ n: number }>("select count(*)::int as n from turnering.result_requests where request_id = $1", [REQ]);
    expect(n.rows[0].n).toBe(1);
    const out = await db.query<{ o: { result_version: number } | null }>(
      "select turnering.result_request_outcome($1, $2) as o",
      [REQ, M1],
    );
    expect(out.rows[0].o?.result_version).toBe(1);
    const other = await db.query<{ o: unknown }>("select turnering.result_request_outcome($1, $2) as o", [REQ, M2]);
    expect(other.rows[0].o).toBeNull();
  });

  it("a different request id after a commit takes the normal conflict path", async () => {
    await expect(submit(M1, 0, REQ2)).rejects.toThrow(/version_conflict/);
    expect(await ver(M1)).toBe(1);
    const ok = await submit(M1, 1, REQ3, 2);
    expect(ok.rows[0].v).toBe(2);
  });

  it("a conflict records nothing, so the id can be retried later", async () => {
    const n = await db.query<{ n: number }>("select count(*)::int as n from turnering.result_requests where request_id = $1", [REQ2]);
    expect(n.rows[0].n).toBe(0);
  });

  it("the legacy 5- and 6-arg overloads still work", async () => {
    expect((await submit(M2, 0, null)).rows[0].v).toBe(1);
  });

  it("is executable by service_role only and re-applying is a no-op", async () => {
    const r = await db.query<{ a: boolean; s: boolean; o: boolean }>(
      `select has_function_privilege('anon', 'turnering.submit_match_result(uuid,int,jsonb,uuid,text,text,uuid)', 'execute') as a,
              has_function_privilege('service_role', 'turnering.submit_match_result(uuid,int,jsonb,uuid,text,text,uuid)', 'execute') as s,
              has_function_privilege('service_role', 'turnering.result_request_outcome(uuid,uuid)', 'execute') as o`,
    );
    expect(r.rows[0]).toEqual({ a: false, s: true, o: true });
    await db.exec(readFileSync(join(MIGRATIONS, "0015_idempotent_result.sql"), "utf8"));
  });
});
