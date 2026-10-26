import { describe, it, expect } from "vitest";
import { computeAwards } from "@/lib/tournament/awards";
import { computeStandings } from "@/lib/tournament/standings";
import type { Match, ScoringConfig, Team } from "@/lib/types";

const cfg: ScoringConfig = {
  profile: "simple",
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  allowDraw: true,
};

function team(id: string, name: string): Team {
  return {
    id,
    tournament_id: "t",
    name,
    colour: "#fff",
    logo_url: null,
    seed: null,
    sort_order: 0,
    members: [],
    group_no: null,
  };
}

let mid = 0;
function match(home: string, away: string, h: number, a: number): Match {
  return {
    id: `m${mid++}`,
    tournament_id: "t",
    phase: "league",
    round: 1,
    bracket_slot: null,
    group_no: null,
    court_id: null,
    queue_order: mid, scheduled_at: null, called_at: null,
    home_team_id: home,
    away_team_id: away,
    status: "done",
    result: { home: h, away: a },
    winner_team_id: h > a ? home : a > h ? away : null,
    locked_by: null,
    result_by: null,
    result_version: 1,
    updated_at: "",
  };
}

describe("computeAwards", () => {
  const teams = [team("a", "Alfa"), team("b", "Bravo"), team("c", "Charlie")];
  const matches = [
    match("a", "b", 5, 0), // Alfa biggest win, also highest scoring tie
    match("a", "c", 2, 1), // Alfa wins again
    match("b", "c", 1, 1), // draw
  ];
  const standings = computeStandings(teams, matches, cfg);
  const awards = computeAwards(teams, matches, standings, cfg);

  const byKind = (k: string) => awards.find((x) => x.kind === k);

  it("names the table-topper as team of the night", () => {
    expect(byKind("team_of_night")?.teamId).toBe("a");
  });

  it("finds most wins", () => {
    const w = byKind("most_wins");
    expect(w?.teamId).toBe("a");
    expect(w?.detail).toContain("2");
  });

  it("finds the biggest win", () => {
    const b = byKind("biggest_win");
    expect(b?.teamId).toBe("a");
    expect(b?.detail).toBe("Alfa 5–0 Bravo");
  });

  it("finds the highest-scoring match", () => {
    expect(byKind("highest_scoring")?.detail).toBe("Alfa 5–0 Bravo");
  });

  it("finds best attack and best defense", () => {
    expect(byKind("best_attack")?.teamId).toBe("a"); // 7 scored
    expect(byKind("best_defense")).toBeTruthy();
  });

  it("skips score-based awards for the winner-only profile", () => {
    const wcfg: ScoringConfig = { ...cfg, profile: "winner", allowDraw: false };
    const wMatches = [
      { ...match("a", "b", 1, 0), result: { winner: "home" as const } },
      { ...match("a", "c", 1, 0), result: { winner: "home" as const } },
    ];
    const wStand = computeStandings(teams, wMatches, wcfg);
    const wAwards = computeAwards(teams, wMatches, wStand, wcfg);
    expect(wAwards.some((x) => x.kind === "most_wins")).toBe(true);
    expect(wAwards.some((x) => x.kind === "biggest_win")).toBe(false);
    expect(wAwards.some((x) => x.kind === "best_attack")).toBe(false);
  });
});

describe("standings form guide", () => {
  const teams = [team("a", "Alfa"), team("b", "Bravo")];
  it("records W/D/L in chronological order", () => {
    const matches = [match("a", "b", 3, 0), match("b", "a", 2, 2)];
    const s = computeStandings(teams, matches, cfg);
    expect(s.find((r) => r.team_id === "a")!.form).toEqual(["W", "D"]);
    expect(s.find((r) => r.team_id === "b")!.form).toEqual(["L", "D"]);
  });
});

describe("computeAwards — vinneren og snitt per kamp (C8)", () => {
  const find = (aw: ReturnType<typeof computeAwards>, k: string) => aw.find((x) => x.kind === k);

  it("kveldens lag er mesteren, ikke serievinneren som tapte finalen", () => {
    const teams = [team("a", "Alfa"), team("b", "Bravo")];
    const matches = [match("a", "b", 3, 0)];
    const standings = computeStandings(teams, matches, cfg);
    expect(find(computeAwards(teams, matches, standings, cfg), "team_of_night")?.teamId).toBe("a"); // tabelleder
    expect(
      find(computeAwards(teams, matches, standings, cfg, { championId: "b" }), "team_of_night")?.teamId,
    ).toBe("b");
  });

  it("gruppespill uten mester: den blandede tabellen kårer ingen", () => {
    const teams = [team("a", "Alfa"), team("b", "Bravo")];
    const matches = [match("a", "b", 3, 0)];
    const standings = computeStandings(teams, matches, cfg);
    expect(find(computeAwards(teams, matches, standings, cfg, { groupPlay: true }), "team_of_night")).toBeUndefined();
  });

  it("angrep er snitt per kamp: 7 på 3 kamper slår 2 per kamp", () => {
    const teams = [team("a", "Alfa"), team("b", "Bravo"), team("c", "Charlie"), team("d", "Delta")];
    const matches = [
      match("a", "b", 2, 2), match("a", "c", 2, 2), match("a", "d", 2, 2), // Alfa: 2 per kamp
      match("b", "c", 1, 0), match("b", "d", 4, 0), // Bravo: 7 scoret på 3 kamper
    ];
    const aw = computeAwards(teams, matches, computeStandings(teams, matches, cfg), cfg);
    expect(find(aw, "best_attack")?.teamId).toBe("b");
    expect(find(aw, "best_attack")?.detail).toBe("2,3 scoret per kamp");
    expect(find(aw, "best_defense")?.teamId).toBe("b"); // 2 sluppet inn på 3 kamper
    expect(find(aw, "best_defense")?.detail).toBe("0,7 sluppet inn per kamp");
  });

  it("færre kamper gir ikke tettest forsvar av seg selv: samme snitt → flest kamper", () => {
    const teams = [team("a", "Alfa"), team("b", "Bravo"), team("c", "Charlie"), team("d", "Delta")];
    const matches = [
      match("a", "b", 2, 1), match("a", "c", 2, 1), match("a", "b", 1, 1), match("a", "c", 1, 1), // Alfa: 4 sluppet inn på 4
      match("c", "d", 1, 1), // Delta: 1 sluppet inn på 1 (totaler ville gitt Delta prisen)
    ];
    const aw = computeAwards(teams, matches, computeStandings(teams, matches, cfg), cfg);
    expect(find(aw, "best_defense")?.teamId).toBe("a");
    expect(find(aw, "best_defense")?.detail).toBe("1 sluppet inn per kamp");
  });

  it("likt snitt: laget med flest kamper kommer først", () => {
    const teams = [team("a", "Alfa"), team("b", "Bravo"), team("c", "Charlie"), team("d", "Delta")];
    // Alfa og Bravo scorer 2 per kamp; Alfa har spilt to kamper, Bravo én.
    const matches = [match("a", "c", 2, 0), match("a", "d", 2, 0), match("b", "c", 2, 1)];
    const standings = computeStandings(teams, matches, cfg);
    expect(find(computeAwards(teams, matches, standings, cfg), "best_attack")?.teamId).toBe("a");
  });

  it("kamper på tvers av grupper sammenlignes per kamp, og sluttspillkamper teller", () => {
    const g = (m: Match, group: number): Match => ({ ...m, group_no: group });
    const teams = [team("a", "Alfa"), team("b", "Bravo"), team("c", "Charlie"), team("d", "Delta")];
    const matches = [
      g(match("a", "b", 1, 0), 0), // Alfa 1/kamp
      g(match("c", "d", 6, 0), 1), // Charlie 6/kamp i en annen gruppe
    ];
    const standings = computeStandings(teams, matches, cfg);
    const aw = computeAwards(teams, matches, standings, cfg, { groupPlay: true });
    expect(find(aw, "best_attack")?.teamId).toBe("c");
    expect(find(aw, "best_defense")?.teamId).toBe("a"); // 0 sluppet inn; Charlie også 0 men Alfa er først ved likt antall kamper
  });

  it("ingen spilte kamper: ingen angrep/forsvar-utmerkelse", () => {
    const teams = [team("a", "Alfa"), team("b", "Bravo")];
    const aw = computeAwards(teams, [], computeStandings(teams, [], cfg), cfg);
    expect(find(aw, "best_attack")).toBeUndefined();
    expect(find(aw, "best_defense")).toBeUndefined();
  });
});
