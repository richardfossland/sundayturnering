// End-to-end smoke test against a running server (local dev or live Worker).
// Seeds a tournament, plays a full league, checks standings + the optimistic
// concurrency guard. Requires the dev seed route (non-production) for setup.
//
//   BASE=http://localhost:3000 node scripts/smoke.mjs
//   BASE=https://turnering.sundaysuite.app node scripts/smoke.mjs   (seed route 404 in prod)

const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0, fail = 0;
const check = (n, c, x = "") => (c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + " " + x)));

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
async function get(path) {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  console.log(`SundayTurnering smoke — ${BASE}\n`);

  const seed = await post("/api/dev/seed", { teams: 4, format: "league", profile: "simple" });
  check("seed 4-team league", seed.status === 200 && !!seed.json.id, JSON.stringify(seed.json));
  if (!seed.json.id) return done();
  const id = seed.json.id;

  let { json: state } = await get(`/api/tournament/${id}`);
  check("league has 6 matches", state.matches.filter((m) => m.away_team_id).length === 6);
  check("empty standings present (4 rows)", state.standings.length === 4);

  // Play every league match: home wins 2–0.
  const league = state.matches.filter((m) => m.away_team_id);
  for (const m of league) {
    const r = await post("/api/match/result", {
      matchId: m.id,
      expectedVersion: m.result_version,
      result: { home: 2, away: 0 },
    });
    check(`result accepted ${m.id.slice(0, 6)}`, r.status === 200, JSON.stringify(r.json));
  }

  ({ json: state } = await get(`/api/tournament/${id}`));
  const allDone = state.matches.filter((m) => m.away_team_id).every((m) => m.status === "done");
  check("all league matches done", allDone);
  const top = state.standings[0];
  check("standings computed + sorted", top && top.points >= state.standings[1].points);
  check("played counts correct", state.standings.every((s) => s.played === 3));

  // Concurrency guard: a stale version is rejected.
  const seed2 = await post("/api/dev/seed", { teams: 2, format: "league" });
  const { json: s2 } = await get(`/api/tournament/${seed2.json.id}`);
  const m = s2.matches.find((x) => x.away_team_id);
  const first = await post("/api/match/result", { matchId: m.id, expectedVersion: m.result_version, result: { home: 1, away: 0 } });
  check("first submit wins", first.status === 200);
  const stale = await post("/api/match/result", { matchId: m.id, expectedVersion: m.result_version, result: { home: 0, away: 1 } });
  // Second submit must be rejected (409): the first made the match 'done', so it
  // is refused as kamp_ferdig (or konflikt on a true same-instant version race).
  check(
    "second submit rejected (409, no silent overwrite)",
    stale.status === 409 && ["kamp_ferdig", "konflikt"].includes(stale.json.error),
    JSON.stringify(stale.json),
  );

  // Cup: 5 teams → byes to top seeds, champion resolves.
  const cup = await post("/api/dev/seed", { teams: 5, format: "cup" });
  const { json: cs } = await get(`/api/tournament/${cup.json.id}`);
  const byes = cs.matches.filter((x) => x.status === "bye");
  check("5-team cup has 3 byes", byes.length === 3, `got ${byes.length}`);

  // Special results: walkover counts as a played win; abandoned is voided.
  const wo = await post("/api/dev/seed", { teams: 2, format: "league" });
  const { json: ws } = await get(`/api/tournament/${wo.json.id}`);
  const wm = ws.matches.find((x) => x.away_team_id);
  const woRes = await post("/api/match/result", {
    matchId: wm.id, expectedVersion: wm.result_version,
    result: { special: "walkover", winner: "home" },
  });
  check("walkover accepted", woRes.status === 200, JSON.stringify(woRes.json));
  const { json: wsA } = await get(`/api/tournament/${wo.json.id}`);
  const woHome = wsA.standings.find((s) => s.team_id === wm.home_team_id);
  check("walkover → winner gets a played win (3 pts)", !!woHome && woHome.played === 1 && woHome.won === 1 && woHome.points === 3, JSON.stringify(woHome));

  const ab = await post("/api/dev/seed", { teams: 2, format: "league" });
  const { json: abs } = await get(`/api/tournament/${ab.json.id}`);
  const abm = abs.matches.find((x) => x.away_team_id);
  const abRes = await post("/api/match/result", { matchId: abm.id, expectedVersion: abm.result_version, result: { special: "abandoned" } });
  check("abandoned accepted", abRes.status === 200, JSON.stringify(abRes.json));
  const { json: abA } = await get(`/api/tournament/${ab.json.id}`);
  check("abandoned → voided (0 played)", abA.standings.every((s) => s.played === 0));

  // Self-correct grace window: same device fixes its own result; others 403.
  const sc = await post("/api/dev/seed", { teams: 2, format: "league" });
  const { json: scs } = await get(`/api/tournament/${sc.json.id}`);
  const scm = scs.matches.find((x) => x.away_team_id);
  const dev = "dev-smoke";
  const r1 = await post("/api/match/result", { matchId: scm.id, expectedVersion: scm.result_version, result: { home: 1, away: 0 }, deviceId: dev, deviceName: "Smoke" });
  check("result saved with device id", r1.status === 200, JSON.stringify(r1.json));
  const ver = r1.json.match?.result_version;
  const wrong = await post("/api/match/correct", { matchId: scm.id, expectedVersion: ver, result: { home: 0, away: 1 }, deviceId: "other" });
  check("self-correct rejected for a different device (403)", wrong.status === 403, JSON.stringify(wrong.json));
  const corr = await post("/api/match/correct", { matchId: scm.id, expectedVersion: ver, result: { home: 0, away: 2 }, deviceId: dev, deviceName: "Smoke" });
  check("self-correct accepted in window", corr.status === 200, JSON.stringify(corr.json));

  // Group stage + playoff + bronze final.
  const gp = await post("/api/dev/seed", { teams: 4, format: "group_playoff", groupCount: 2, advancePerGroup: 2, thirdPlace: true });
  const { json: gs } = await get(`/api/tournament/${gp.json.id}`);
  check("group stage exposes 2 group tables", (gs.groupStandings || []).length === 2, JSON.stringify((gs.groupStandings || []).length));
  for (const m of gs.matches.filter((x) => x.away_team_id && x.phase === "league")) {
    await post("/api/match/result", { matchId: m.id, expectedVersion: m.result_version, result: { home: 2, away: 0 } });
  }
  const adv = await post("/api/organiser/advance", { tournamentId: gp.json.id, organiserCode: gp.json.organiser_code });
  check("group → playoff advance ok", adv.status === 200, JSON.stringify(adv.json));
  const { json: gp2 } = await get(`/api/tournament/${gp.json.id}`);
  const playoff = gp2.matches.filter((m) => m.phase === "playoff");
  check("bracket built from group qualifiers (semis+final+bronze = 4)", playoff.length === 4, `got ${playoff.length}`);
  check("bronze final present", playoff.some((m) => m.bracket_slot === 1));

  done();
}
function done() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
