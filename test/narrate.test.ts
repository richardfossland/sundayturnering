import { describe, it, expect } from "vitest";
import { diffSnapshots, rank, type Storyline } from "@/lib/tournament/narrate";
import type { StateDTO, TournamentDTO } from "@/lib/dto";
import type { Match, StandingRow, Team } from "@/lib/types";

// ---------- fixture builders (canned, no network, no key) ----------

function tournament(over: Partial<TournamentDTO> = {}): TournamentDTO {
  return {
    id: "t1",
    control_code: "111111",
    board_code: "222222",
    title: "Cup",
    sport_label: "Fotball",
    format: "league_playoff",
    scoring: {
      profile: "simple",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      allowDraw: true,
    },
    parallelism: "sequential",
    config: { playoffSize: 2, roundRobinDouble: false },
    status: "league",
    version: 1,
    timer: null,
    ...over,
  };
}

function team(id: string, name: string, seed: number | null = null): Team {
  return {
    id,
    tournament_id: "t1",
    name,
    colour: "#fff",
    logo_url: null,
    seed,
    sort_order: 0,
    members: [],
    group_no: null,
  };
}

let mid = 0;
function match(over: Partial<Match> = {}): Match {
  return {
    id: `m${mid++}`,
    tournament_id: "t1",
    phase: "league",
    round: 1,
    bracket_slot: null,
    group_no: null,
    court_id: null,
    queue_order: 0,
    home_team_id: "a",
    away_team_id: "b",
    status: "scheduled",
    result: null,
    winner_team_id: null,
    locked_by: null,
    result_by: null,
    result_version: 0,
    updated_at: "",
    ...over,
  };
}

function standing(over: Partial<StandingRow> & { team_id: string }): StandingRow {
  return {
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    points: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    diff: 0,
    rank: 1,
    inPlayoff: false,
    ...over,
  };
}

function state(over: Partial<StateDTO> = {}): StateDTO {
  return {
    tournament: tournament(),
    teams: [team("a", "Alfa"), team("b", "Bravo")],
    courts: [],
    matches: [],
    standings: [],
    ...over,
  };
}

const find = (lines: Storyline[], kind: string) =>
  lines.find((l) => l.kind === kind);

// ---------- tests ----------

describe("diffSnapshots — results", () => {
  it("narrates a newly completed win", () => {
    const m = match({ id: "x", status: "scheduled" });
    const before = state({ matches: [m] });
    const after = state({
      matches: [{ ...m, status: "done", result: { home: 2, away: 1 }, result_version: 1 }],
    });
    const lines = diffSnapshots(before, after);
    const r = find(lines, "result")!;
    expect(r).toBeTruthy();
    expect(r.headline).toContain("Alfa");
    expect(r.headline).toContain("Bravo");
    expect(r.detail).toBe("2–1");
    expect(r.display).toBe("ticker");
  });

  it("does NOT re-narrate a match that was already done", () => {
    const m = match({ id: "x", status: "done", result: { home: 2, away: 1 }, result_version: 1 });
    const before = state({ matches: [m] });
    const after = state({ matches: [{ ...m }] });
    expect(diffSnapshots(before, after).filter((l) => l.key.startsWith("result"))).toHaveLength(0);
  });

  it("re-narrates when a result is corrected (result_version bumps)", () => {
    const m = match({ id: "x", status: "done", result: { home: 2, away: 1 }, result_version: 1 });
    const before = state({ matches: [m] });
    const after = state({
      matches: [{ ...m, result: { home: 1, away: 2 }, result_version: 2 }],
    });
    const lines = diffSnapshots(before, after).filter((l) => l.key.startsWith("result"));
    expect(lines).toHaveLength(1);
    expect(lines[0].headline).toContain("Bravo"); // Bravo now won
  });

  it("flags a lopsided simple win as a rout (cut-in)", () => {
    const m = match({ id: "x", status: "scheduled" });
    const before = state({ matches: [m] });
    const after = state({
      matches: [{ ...m, status: "done", result: { home: 7, away: 1 }, result_version: 1 }],
    });
    const rout = find(diffSnapshots(before, after), "rout")!;
    expect(rout).toBeTruthy();
    expect(rout.display).toBe("cutin");
    expect(rout.headline).toContain("6"); // margin
    expect(rout.priority).toBeGreaterThan(find(diffSnapshots(before, after), "rout")!.priority - 1);
  });

  it("flags an upset when a lower seed beats a higher seed", () => {
    const before = state({
      teams: [team("a", "Alfa", 1), team("b", "Bravo", 8)],
      matches: [match({ id: "x", status: "scheduled" })],
    });
    const after = state({
      teams: [team("a", "Alfa", 1), team("b", "Bravo", 8)],
      matches: [
        match({ id: "x", status: "done", result: { home: 0, away: 1 }, result_version: 1 }),
      ],
    });
    const upset = find(diffSnapshots(before, after), "upset")!;
    expect(upset).toBeTruthy();
    expect(upset.headline).toContain("Bravo"); // underdog winner
    expect(upset.display).toBe("cutin");
  });

  it("narrates a draw", () => {
    const m = match({ id: "x", status: "scheduled" });
    const before = state({ matches: [m] });
    const after = state({
      matches: [{ ...m, status: "done", result: { home: 1, away: 1 }, result_version: 1 }],
    });
    const draw = find(diffSnapshots(before, after), "draw")!;
    expect(draw).toBeTruthy();
    expect(draw.display).toBe("ticker");
  });

  it("ignores byes (away null)", () => {
    const m = match({ id: "x", away_team_id: null, status: "bye" });
    const before = state({ matches: [m] });
    const after = state({
      matches: [{ ...m, status: "done", result_version: 1 }],
    });
    expect(diffSnapshots(before, after)).toHaveLength(0);
  });
});

describe("diffSnapshots — kickoff", () => {
  it("narrates a match going live", () => {
    const m = match({ id: "x", status: "scheduled" });
    const before = state({ matches: [m] });
    const after = state({ matches: [{ ...m, status: "live" }] });
    const live = find(diffSnapshots(before, after), "live")!;
    expect(live).toBeTruthy();
    expect(live.display).toBe("ticker");
  });
});

describe("diffSnapshots — standings", () => {
  it("narrates a lead change at the top", () => {
    const before = state({
      standings: [
        standing({ team_id: "a", rank: 1, points: 6, played: 2 }),
        standing({ team_id: "b", rank: 2, points: 3, played: 2 }),
      ],
    });
    const after = state({
      standings: [
        standing({ team_id: "b", rank: 1, points: 9, played: 3 }),
        standing({ team_id: "a", rank: 2, points: 6, played: 3 }),
      ],
    });
    const lead = find(diffSnapshots(before, after), "lead_change")!;
    expect(lead).toBeTruthy();
    expect(lead.headline).toContain("Bravo");
    expect(lead.teamId).toBe("b");
  });

  it("does not narrate a lead change before any match is played", () => {
    const before = state({ standings: [] });
    const after = state({
      standings: [standing({ team_id: "a", rank: 1, points: 0, played: 0 })],
    });
    expect(find(diffSnapshots(before, after), "lead_change")).toBeUndefined();
  });

  it("narrates a newly clinched playoff spot once", () => {
    const before = state({
      standings: [standing({ team_id: "a", rank: 1, played: 1, inPlayoff: false })],
    });
    const after = state({
      standings: [standing({ team_id: "a", rank: 1, played: 2, inPlayoff: true })],
    });
    const lines = diffSnapshots(before, after).filter((l) => l.kind === "clinch");
    expect(lines).toHaveLength(1);
    expect(lines[0].teamId).toBe("a");

    // Already in playoff next diff → no repeat.
    const after2 = state({
      standings: [standing({ team_id: "a", rank: 1, played: 3, inPlayoff: true })],
    });
    expect(diffSnapshots(after, after2).filter((l) => l.kind === "clinch")).toHaveLength(0);
  });
});

describe("diffSnapshots — phases", () => {
  it("narrates the playoff start", () => {
    const before = state({ tournament: tournament({ status: "league" }) });
    const after = state({ tournament: tournament({ status: "playoff" }) });
    const p = find(diffSnapshots(before, after), "playoff")!;
    expect(p).toBeTruthy();
    expect(p.display).toBe("cutin");
  });

  it("narrates the final kicking off", () => {
    const fin = match({
      id: "f",
      phase: "playoff",
      round: 1,
      home_team_id: "a",
      away_team_id: "b",
      status: "scheduled",
    });
    const before = state({
      tournament: tournament({ status: "playoff" }),
      matches: [fin],
    });
    const after = state({
      tournament: tournament({ status: "playoff" }),
      matches: [{ ...fin, status: "live" }],
    });
    const f = find(diffSnapshots(before, after), "final")!;
    expect(f).toBeTruthy();
    expect(f.headline).toContain("Alfa");
    expect(f.headline).toContain("Bravo");
  });

  it("crowns the champion when the tournament finishes (bracket winner)", () => {
    const fin = match({
      id: "f",
      phase: "playoff",
      round: 1,
      home_team_id: "a",
      away_team_id: "b",
      status: "done",
      result: { home: 2, away: 0 },
      winner_team_id: "a",
      result_version: 1,
    });
    const before = state({
      tournament: tournament({ status: "playoff" }),
      matches: [fin],
    });
    const after = state({
      tournament: tournament({ status: "finished" }),
      matches: [fin],
    });
    const champ = find(diffSnapshots(before, after), "champion")!;
    expect(champ).toBeTruthy();
    expect(champ.priority).toBe(100);
    expect(champ.teamId).toBe("a");
    expect(champ.headline).toContain("Alfa");
  });

  it("crowns the league leader when a pure league finishes", () => {
    const before = state({
      tournament: tournament({ format: "league", status: "league" }),
      standings: [standing({ team_id: "b", rank: 1, points: 9, played: 3 })],
    });
    const after = state({
      tournament: tournament({ format: "league", status: "finished" }),
      standings: [standing({ team_id: "b", rank: 1, points: 9, played: 3 })],
    });
    const champ = find(diffSnapshots(before, after), "champion")!;
    expect(champ.teamId).toBe("b");
  });
});

describe("diffSnapshots — first load", () => {
  it("returns nothing for a fresh in-progress snapshot (no before)", () => {
    const after = state({
      matches: [match({ id: "x", status: "done", result: { home: 2, away: 1 }, result_version: 1 })],
    });
    // No phantom result cards on first paint.
    expect(diffSnapshots(null, after).filter((l) => l.kind === "result")).toHaveLength(0);
  });

  it("announces an already-finished tournament on first load", () => {
    const after = state({
      tournament: tournament({ format: "league", status: "finished" }),
      standings: [standing({ team_id: "a", rank: 1, points: 9, played: 3 })],
    });
    expect(find(diffSnapshots(null, after), "champion")).toBeTruthy();
  });
});

describe("rank", () => {
  it("orders by priority desc then key", () => {
    const lines: Storyline[] = [
      { key: "b", kind: "result", priority: 25, headline: "", display: "ticker" },
      { key: "a", kind: "champion", priority: 100, headline: "", display: "cutin" },
      { key: "a", kind: "result", priority: 25, headline: "", display: "ticker" },
    ];
    const ordered = rank(lines);
    expect(ordered[0].kind).toBe("champion");
    expect(ordered[1].key).toBe("a");
    expect(ordered[2].key).toBe("b");
  });

  it("is deterministic and pure (does not mutate input)", () => {
    const lines: Storyline[] = [
      { key: "z", kind: "draw", priority: 30, headline: "", display: "ticker" },
      { key: "y", kind: "upset", priority: 70, headline: "", display: "cutin" },
    ];
    const snapshot = JSON.stringify(lines);
    rank(lines);
    expect(JSON.stringify(lines)).toBe(snapshot);
  });
});
