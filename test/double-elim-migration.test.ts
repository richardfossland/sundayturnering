import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDoubleElim } from "@/lib/tournament/doubleElim";

// Migrasjon 0017 (format 'double_elim' + omkamp i propagate_playoff_result) mot en
// ekte Postgres i minnet: hele 0001…0018 kjøres, så spilles dobbel utslag gjennom
// RPC-ene `propagate_playoff_result` og `override_match_result`.

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");

let db: PGlite;

async function uid(): Promise<string> {
  const r = await db.query<{ id: string }>("select gen_random_uuid()::text as id");
  return r.rows[0].id;
}

interface Seeded {
  t: string;
  teams: string[];
  id: Map<string, string>; // "W:1:0" → match-id
}

/** Bygger en dobbel utslag med `n` lag rett i databasen (som build.ts). */
async function seed(n: number, reset = true): Promise<Seeded> {
  const t = await uid();
  await db.query(
    `insert into turnering.tournaments (id, control_code, board_code, organiser_code, format, status)
     values ($1, $2, 'b', 'o', 'double_elim', 'playoff')`,
    [t, String(Math.floor(Math.random() * 900000) + 100000)],
  );
  const teams: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = await uid();
    teams.push(id);
    await db.query("insert into turnering.teams (id, tournament_id, name) values ($1, $2, $3)", [id, t, `T${i + 1}`]);
  }
  const set = buildDoubleElim(teams, { grandFinalReset: reset });
  const id = new Map<string, string>();
  const key = (b: string, r: number, s: number) => `${b}:${r}:${s}`;
  for (const { id: b, bracket } of set.brackets)
    for (const m of bracket.matches) {
      const mid = await uid();
      id.set(key(b, m.round, m.slot), mid);
      await db.query(
        `insert into turnering.matches
           (id, tournament_id, phase, round, bracket_slot, bracket, home_team_id, away_team_id, status, winner_team_id)
         values ($1, $2, 'playoff', $3, $4, $5, $6, $7, $8, $9)`,
        [mid, t, m.round, m.slot, b, m.homeId, m.awayId, m.status, m.winnerId],
      );
    }
  const link = (from: string, to: string, side: string, feed: string) =>
    db.query(
      `insert into turnering.bracket_links (tournament_id, from_match_id, to_match_id, to_slot, feed)
       values ($1, $2, $3, $4, $5)`,
      [t, id.get(from), id.get(to), side, feed],
    );
  for (const { id: b, bracket } of set.brackets)
    for (const l of bracket.links)
      await link(key(b, l.fromRound, l.fromSlot), key(b, l.toRound, l.toSlot), l.toSide, l.feed);
  for (const c of set.cross)
    await link(key(c.fromBracket, c.fromRound, c.fromSlot), key(c.toBracket, c.toRound, c.toSlot), c.toSide, c.feed);
  return { t, teams, id };
}

interface Row { id: string; home_team_id: string | null; away_team_id: string | null; status: string; winner_team_id: string | null; bracket: string; round: number }

async function matchesOf(t: string): Promise<Row[]> {
  const r = await db.query<Row>(
    "select id, home_team_id, away_team_id, status, winner_team_id, bracket, round from turnering.matches where tournament_id = $1",
    [t],
  );
  return r.rows;
}

async function finish(matchId: string, side: "home" | "away") {
  const r = await db.query<{ home_team_id: string; away_team_id: string }>(
    "select home_team_id, away_team_id from turnering.matches where id = $1",
    [matchId],
  );
  const winner = side === "home" ? r.rows[0].home_team_id : r.rows[0].away_team_id;
  await db.query(
    "update turnering.matches set status = 'done', winner_team_id = $2, result_version = result_version + 1 where id = $1",
    [matchId, winner],
  );
  const p = await db.query<{ finished: boolean; propagated: boolean }>(
    "select * from turnering.propagate_playoff_result($1)",
    [matchId],
  );
  return p.rows[0];
}

async function statusOf(t: string): Promise<string> {
  const r = await db.query<{ status: string }>("select status from turnering.tournaments where id = $1", [t]);
  return r.rows[0].status;
}

/** Spill alle kamper som er klare, til ingen er igjen. `pick` velger side. */
async function playAll(
  t: string,
  pick: (m: Row) => "home" | "away",
): Promise<{ played: number; lastFinished: boolean }> {
  let played = 0;
  let lastFinished = false;
  for (;;) {
    const next = (await matchesOf(t)).find((m) => m.status === "scheduled" && m.home_team_id && m.away_team_id);
    if (!next) break;
    lastFinished = (await finish(next.id, pick(next))).finished;
    played++;
  }
  return { played, lastFinished };
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
  expect(files.at(-1)).toBe("0018_swiss.sql");
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  // Idempotent: 0017 på nytt skal ikke feile.
  await db.exec(readFileSync(join(MIGRATIONS, "0017_double_elim.sql"), "utf8"));
});

describe("0017 format", () => {
  it("godtar double_elim, avviser ukjent format", async () => {
    await seed(4);
    await expect(
      db.query(
        `insert into turnering.tournaments (id, control_code, board_code, organiser_code, format)
         values (gen_random_uuid(), '111222', 'b', 'o', 'bogus')`,
      ),
    ).rejects.toThrow();
  });
});

describe("dobbel utslag via propagate_playoff_result", () => {
  it("W-vinneren vinner storfinalen: omkampen utgår og turneringen er ferdig", async () => {
    const { t } = await seed(8);
    // Hjemme vinner alltid → W-vinneren (hjemme i storfinalen) vinner.
    const { played, lastFinished } = await playAll(t, () => "home");
    expect(played).toBe(2 * 8 - 2);
    expect(lastFinished).toBe(true);
    expect(await statusOf(t)).toBe("finished");
    const gf2 = (await matchesOf(t)).find((m) => m.bracket === "GF" && m.round === 2)!;
    expect(gf2.status).toBe("bye");
    const gf1 = (await matchesOf(t)).find((m) => m.bracket === "GF" && m.round === 1)!;
    expect(gf2.winner_team_id).toBe(gf1.winner_team_id);
  });

  it("L-vinneren vinner storfinalen: omkampen spilles, og først den avslutter", async () => {
    const { t } = await seed(8);
    // Borte vinner i storfinalen (L-laget), ellers hjemme.
    let sawUnfinishedAfterGf1 = false;
    for (;;) {
      const next = (await matchesOf(t)).find((m) => m.status === "scheduled" && m.home_team_id && m.away_team_id);
      if (!next) break;
      const isGf1 = next.bracket === "GF" && next.round === 1;
      const r = await finish(next.id, isGf1 ? "away" : "home");
      if (isGf1) {
        expect(r.finished).toBe(false);
        sawUnfinishedAfterGf1 = true;
        expect(await statusOf(t)).toBe("playoff");
      }
    }
    expect(sawUnfinishedAfterGf1).toBe(true);
    expect(await statusOf(t)).toBe("finished");
    const all = await matchesOf(t);
    const gf1 = all.find((m) => m.bracket === "GF" && m.round === 1)!;
    const gf2 = all.find((m) => m.bracket === "GF" && m.round === 2)!;
    expect(gf2.status).toBe("done");
    // Omkampen: GF1-vinneren (L-laget) hjemme, taperen (W-laget) borte.
    expect(gf2.home_team_id).toBe(gf1.winner_team_id);
    expect(gf2.away_team_id).toBe(gf1.home_team_id);
  });

  it("uten omkamp avgjør storfinalen", async () => {
    const { t } = await seed(4, false);
    const { played, lastFinished } = await playAll(t, (m) => (m.bracket === "GF" ? "away" : "home"));
    expect(played).toBe(2 * 4 - 2);
    expect(lastFinished).toBe(true);
    expect(await statusOf(t)).toBe("finished");
  });

  it("tilfeldige vinnere, 3–16 lag: ferdig nøyaktig når siste avgjørende kamp er spilt", async () => {
    for (const n of [3, 5, 6, 7, 10, 16]) {
      const { t, teams } = await seed(n);
      let i = 0;
      const losses = new Map<string, number>();
      for (;;) {
        const next = (await matchesOf(t)).find((m) => m.status === "scheduled" && m.home_team_id && m.away_team_id);
        if (!next) break;
        // Deterministisk «tilfeldig» side.
        const side = (i++ * 7 + n) % 3 === 0 ? "away" : "home";
        const r = await finish(next.id, side);
        const loser = side === "home" ? next.away_team_id! : next.home_team_id!;
        losses.set(loser, (losses.get(loser) ?? 0) + 1);
        expect(r.finished).toBe((await statusOf(t)) === "finished");
      }
      expect(await statusOf(t)).toBe("finished");
      // Ingen lag har mer enn to tap.
      for (const team of teams) expect(losses.get(team) ?? 0).toBeLessThanOrEqual(2);
    }
  });

  it("frirunder: 5 lag spilles ferdig uten at noen venter på en tom plass", async () => {
    const { t } = await seed(5);
    const { played } = await playAll(t, () => "home");
    expect(played).toBe(2 * 5 - 2);
    expect(await statusOf(t)).toBe("finished");
    const stuck = (await matchesOf(t)).filter((m) => m.status === "scheduled");
    expect(stuck).toEqual([]);
  });
});

describe("overstyring av dobbel utslag (override_match_result)", () => {
  const override = (id: string, side: "home" | "away", allowReset = false) =>
    db.query("select * from turnering.override_match_result($1, '{\"winner\":\"" + side + "\"}'::jsonb, $2, $3)", [
      id,
      side,
      allowReset,
    ]);

  it("storfinalen snus fra W- til L-seier: turneringen åpnes og omkampen gjenåpnes", async () => {
    const { t } = await seed(4);
    await playAll(t, () => "home");
    expect(await statusOf(t)).toBe("finished");
    const gf1 = (await matchesOf(t)).find((m) => m.bracket === "GF" && m.round === 1)!;
    await override(gf1.id, "away");
    const all = await matchesOf(t);
    const gf2 = all.find((m) => m.bracket === "GF" && m.round === 2)!;
    expect(gf2.status).toBe("scheduled");
    expect(gf2.winner_team_id).toBeNull();
    expect(await statusOf(t)).toBe("playoff");
    const newGf1 = all.find((m) => m.id === gf1.id)!;
    expect(gf2.home_team_id).toBe(newGf1.winner_team_id);
    // Spill omkampen: nå avsluttes turneringen.
    await playAll(t, () => "home");
    expect(await statusOf(t)).toBe("finished");
  });

  it("omkampen spilt, storfinalen snus til W-seier: krever bekreftelse, så utgår omkampen", async () => {
    const { t } = await seed(4);
    await playAll(t, (m) => (m.bracket === "GF" && m.round === 1 ? "away" : "home"));
    const all0 = await matchesOf(t);
    const gf1 = all0.find((m) => m.bracket === "GF" && m.round === 1)!;
    expect(all0.find((m) => m.bracket === "GF" && m.round === 2)!.status).toBe("done");
    await expect(override(gf1.id, "home")).rejects.toThrow();
    await override(gf1.id, "home", true);
    const gf2 = (await matchesOf(t)).find((m) => m.bracket === "GF" && m.round === 2)!;
    expect(gf2.status).toBe("bye");
    expect(await statusOf(t)).toBe("finished");
  });

  it("endret W-resultat nullstiller avhengige L-kamper (med bekreftelse)", async () => {
    const { t, id } = await seed(4);
    // W1 begge, W-finalen, så L1 (taperne av W1) er spilt.
    const w10 = id.get("W:1:0")!;
    const w11 = id.get("W:1:1")!;
    await finish(w10, "home");
    await finish(w11, "home");
    const l1 = (await matchesOf(t)).find((m) => m.bracket === "L" && m.round === 1)!;
    expect(l1.home_team_id && l1.away_team_id).toBeTruthy();
    await finish(l1.id, "home");
    await expect(override(w10, "away")).rejects.toThrow();
    await override(w10, "away", true);
    const after = await matchesOf(t);
    const l1After = after.find((m) => m.id === l1.id)!;
    expect(l1After.status).toBe("scheduled");
    expect(l1After.winner_team_id).toBeNull();
    // Taperen av W1-kamp 0 er nå den andre siden.
    const w10After = after.find((m) => m.id === w10)!;
    const newLoser = w10After.home_team_id;
    expect(l1After.home_team_id).toBe(newLoser);
  });
});
