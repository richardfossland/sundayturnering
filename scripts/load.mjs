// Classroom load test: ~30 phones behind ONE school-wifi IP hitting a dev server.
// NOT run in CI (needs a running server with the /api/dev/seed test seam, which
// 404s in production).
//
//   npm run dev                       # in another terminal
//   node scripts/load.mjs [baseUrl]   # default http://localhost:3000, or BASE=…
//
// Env knobs: PHONES (30), UPDATES (10 per phone), LIVE_INTERVAL_MS (1000 —
// the pace of one phone's live score pushes; 30 phones × 1/s = 1800/min, under
// the 2400/min per-IP cap on /api/match/live. Paired phones also skip the
// failed-code lockout via their pairing token.)
//
// What it asserts (exit 1 on any failure):
//   1. PHONES parallel /api/attach with the correct control code → all 200,
//      zero 429s (attach allows 300/min per IP).
//   2. PHONES × UPDATES /api/match/live with the correct code → all 200, zero
//      429s (the correct-code traffic of a whole room must never be throttled).
//   3. Two simultaneous /api/match/result on the SAME match with the same
//      expectedVersion → exactly one 200 and exactly one 409.
//
// All requests come from this one process, i.e. one IP — exactly the school
// scenario. Rate-limit buckets are in-memory per server process, so restart the
// dev server between runs.

const BASE = (process.argv[2] || process.env.BASE || "http://localhost:3000").replace(/\/$/, "");
const PHONES = Number(process.env.PHONES || 30);
const UPDATES = Number(process.env.UPDATES || 10);
const LIVE_INTERVAL_MS = Number(process.env.LIVE_INTERVAL_MS || 1000);

let failures = 0;
const check = (name, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : " " + extra}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const tally = (rs) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});

async function main() {
  console.log(`SundayTurnering load — ${BASE} (${PHONES} phones × ${UPDATES} updates)\n`);

  const seed = await post("/api/dev/seed", { teams: 4, format: "league", profile: "simple" });
  if (seed.status !== 200 || !seed.json.id) {
    console.log("seed failed:", seed.status, JSON.stringify(seed.json));
    process.exit(1);
  }
  const { id, control_code: controlCode } = seed.json;
  const state = await (await fetch(`${BASE}/api/tournament/${id}`, { cache: "no-store" })).json();
  const matches = state.matches.filter((m) => m.away_team_id);
  if (matches.length < 2) {
    console.log("need ≥2 playable matches");
    process.exit(1);
  }
  const [dup, ...liveMatches] = matches;

  // 1. attach storm
  console.log("1. attach");
  const attach = await Promise.all(
    Array.from({ length: PHONES }, () => post("/api/attach", { controlCode })),
  );
  const a = tally(attach);
  console.log("   status counts:", JSON.stringify(a));
  check(`${PHONES}/${PHONES} attach → 200`, a[200] === PHONES);
  check("zero 429s on attach", !a[429]);

  // 2. live updates: start the matches, then each phone pushes UPDATES scores.
  console.log("2. live updates");
  for (const m of liveMatches) {
    await post("/api/match/lock", { matchId: m.id, action: "start", deviceId: "load", controlCode });
  }
  const live = [];
  await Promise.all(
    Array.from({ length: PHONES }, async (_, p) => {
      const m = liveMatches[p % liveMatches.length];
      await sleep((p / PHONES) * LIVE_INTERVAL_MS); // de-synchronise the phones
      for (let u = 0; u < UPDATES; u++) {
        live.push(
          await post("/api/match/live", {
            matchId: m.id,
            deviceId: `load-${p}`,
            controlCode,
            result: { home: u, away: 0 },
          }),
        );
        if (u < UPDATES - 1) await sleep(LIVE_INTERVAL_MS);
      }
    }),
  );
  const l = tally(live);
  console.log("   status counts:", JSON.stringify(l));
  check(`${PHONES * UPDATES} live updates → all 200`, l[200] === PHONES * UPDATES, JSON.stringify(l));
  check("zero 429s on live updates", !l[429]);

  // 3. double submit on the same match/version
  console.log("3. simultaneous result submit");
  const submit = (home) =>
    post("/api/match/result", {
      matchId: dup.id,
      expectedVersion: dup.result_version,
      deviceId: `load-dup-${home}`,
      controlCode,
      result: { home, away: 0 },
    });
  const both = await Promise.all([submit(2), submit(3)]);
  const s = tally(both);
  console.log("   status counts:", JSON.stringify(s));
  check("exactly one 200", s[200] === 1);
  check("exactly one 409", s[409] === 1);
  check("no 429/5xx on the submits", !s[429] && !Object.keys(s).some((k) => Number(k) >= 500));

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
