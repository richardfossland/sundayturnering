import { describe, it, expect } from "vitest";
import { championId, finalRanking } from "@/lib/client/view";
import type { StateDTO, TournamentDTO } from "@/lib/dto";
import type { Match, StandingRow, Team } from "@/lib/types";

// B3 + B4: sluttplassering følger sluttspillet (hvor langt hvert lag kom), og en
// turnering avsluttet før finalen har ingen vinner.

function team(id: string, seed: number): Team {
  return {
    id, tournament_id: "t", name: id.toUpperCase(), colour: "#888", logo_url: null,
    seed, sort_order: 0, members: [], group_no: null,
  };
}
const teamsOf = (n: number) => Array.from({ length: n }, (_, i) => team(`t${i + 1}`, i + 1));

function row(team_id: string, rank: number, over: Partial<StandingRow> = {}): StandingRow {
  return {
    team_id, played: 3, won: 0, drawn: 0, lost: 0, points: 0, scoreFor: 0, scoreAgainst: 0,
    diff: 0, rank, inPlayoff: false, ...over,
  };
}
const table = (ids: string[]) => ids.map((id, i) => row(id, i + 1));

let mid = 0;
function ko(
  bracket: "A" | "B" | "W" | "L" | "GF",
  round: number,
  slot: number,
  home: string | null,
  away: string | null,
  winner: string | null,
  status?: Match["status"],
): Match {
  return {
    id: `m${mid++}`, tournament_id: "t", phase: "playoff", round, bracket_slot: slot, group_no: null,
    court_id: null, queue_order: 0, scheduled_at: null, called_at: null,
    home_team_id: home, away_team_id: away,
    status: status ?? (winner ? "done" : "scheduled"),
    result: null, winner_team_id: winner, locked_by: null, result_by: null,
    result_version: winner ? 1 : 0, updated_at: "", bracket,
  } as Match;
}

function state(format: TournamentDTO["format"], p: Partial<StateDTO>, status: TournamentDTO["status"] = "finished"): StateDTO {
  return {
    tournament: { format, status } as TournamentDTO,
    teams: [], courts: [], matches: [], standings: [], ...p,
  };
}
const ids = (s: StateDTO) => finalRanking(s).map((t) => t.id);

// 8-lags sluttspill, seedet etter tabellen t1..t8: 1–8, 4–5, 2–7, 3–6. Bare overraskelser:
// t8 slår t1, t4 slår t5, t7 slår t2, t3 slår t6; t8 slår t4, t3 slår t7 i semifinalen.
const quarters = () => [
  ko("A", 1, 0, "t1", "t8", "t8"),
  ko("A", 1, 1, "t4", "t5", "t4"),
  ko("A", 1, 2, "t2", "t7", "t7"),
  ko("A", 1, 3, "t3", "t6", "t3"),
];
const semis = () => [ko("A", 2, 0, "t8", "t4", "t8"), ko("A", 2, 1, "t7", "t3", "t3")];

describe("finalRanking — liga + sluttspill med 8 lag (B3)", () => {
  const base = { teams: teamsOf(8), standings: table(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"]) };

  it("uten bronsefinale: semifinaletapere over kvartfinaletapere, tabellen avgjør bare innen samme runde", () => {
    const s = state("league_playoff", {
      ...base,
      matches: [...quarters(), ...semis(), ko("A", 3, 0, "t8", "t3", "t3")],
    });
    // t3 mester, t8 finaletaper. Semifinaletaperne t4 og t7 (tabell 4 og 7) FØR tabelleder t1 og t2.
    expect(ids(s)).toEqual(["t3", "t8", "t4", "t7", "t1", "t2", "t5", "t6"]);
  });

  it("med bronsefinale: bronsevinneren er nr. 3, taperen nr. 4", () => {
    const s = state("league_playoff", {
      ...base,
      matches: [...quarters(), ...semis(), ko("A", 3, 0, "t8", "t3", "t3"), ko("A", 3, 1, "t4", "t7", "t7")],
    });
    expect(ids(s)).toEqual(["t3", "t8", "t7", "t4", "t1", "t2", "t5", "t6"]);
  });

  it("bronsefinale ikke spilt ennå: semifinaletaperne er likt og tabellen splitter dem", () => {
    const s = state("league_playoff", {
      ...base,
      matches: [...quarters(), ...semis(), ko("A", 3, 0, "t8", "t3", "t3"), ko("A", 3, 1, "t4", "t7", null)],
    });
    expect(ids(s).slice(0, 4)).toEqual(["t3", "t8", "t4", "t7"]);
  });
});

describe("finalRanking — gruppespill + sluttspill", () => {
  it("sluttspillet først; de som aldri nådde det rangeres etter plass i gruppa, så rekord", () => {
    const teams = teamsOf(8);
    // Gruppe 1: t1 t3 t5 t7, gruppe 2: t2 t4 t6 t8. To videre fra hver.
    const g1 = [row("t1", 1, { points: 9 }), row("t3", 2, { points: 6 }), row("t5", 3, { points: 3 }), row("t7", 4, { points: 0 })];
    const g2 = [row("t2", 1, { points: 9 }), row("t4", 2, { points: 6 }), row("t6", 3, { points: 4 }), row("t8", 4, { points: 0 })];
    const s = state("group_playoff", {
      teams,
      standings: [...g1, ...g2].map((r, i) => ({ ...r, rank: i + 1 })), // flat, blandet
      groupStandings: [{ group_no: 0, rows: g1 }, { group_no: 1, rows: g2 }],
      // Semifinaler: t1–t4 og t2–t3 (kryss). Finale t2–t1.
      matches: [
        ko("A", 1, 0, "t1", "t4", "t1"),
        ko("A", 1, 1, "t2", "t3", "t2"),
        ko("A", 2, 0, "t1", "t2", "t2"),
        ko("A", 2, 1, "t4", "t3", "t3"),
      ],
    });
    expect(ids(s)).toEqual(["t2", "t1", "t3", "t4", "t6", "t5", "t7", "t8"]); // t7 og t8 helt like → gruppe-rekkefølge
  });
});

describe("finalRanking — A- og B-sluttspill", () => {
  it("B-mesteren står øverst blant B-lagene, og alle B-lag etter alle A-lag", () => {
    // Liga + sluttspill, 6 lag: A = t1–t4 (semifinaler + finale), B = t5 mot t6.
    const s = state("league_playoff", {
      teams: teamsOf(6),
      standings: table(["t1", "t2", "t3", "t4", "t5", "t6"]),
      matches: [
        ko("A", 1, 0, "t1", "t4", "t1"),
        ko("A", 1, 1, "t2", "t3", "t3"),
        ko("A", 2, 0, "t1", "t3", "t1"),
        ko("B", 1, 0, "t5", "t6", "t6"),
      ],
    });
    // t6 vant B-finalen og står derfor over t5 selv om t5 var høyere i tabellen.
    expect(ids(s)).toEqual(["t1", "t3", "t2", "t4", "t6", "t5"]);
  });

  it("cup med trøsterunde: første-runde-tapere splittes av B-resultatet", () => {
    // Cup på 6 lag: R1: t3–t6, t4–t5 (t1, t2 har frirunde). Taperne møtes i B.
    const s = state("cup", {
      teams: teamsOf(6),
      matches: [
        ko("A", 1, 0, "t1", null, "t1", "bye"),
        ko("A", 1, 1, "t4", "t5", "t4"),
        ko("A", 1, 2, "t3", "t6", "t3"),
        ko("A", 1, 3, "t2", null, "t2", "bye"),
        ko("A", 2, 0, "t1", "t4", "t1"),
        ko("A", 2, 1, "t3", "t2", "t2"),
        ko("A", 3, 0, "t1", "t2", "t1"),
        ko("B", 1, 0, "t5", "t6", "t6"),
      ],
    });
    // A: t1 mester, t2 finaletaper, semifinaletaperne t3 og t4 (t3 har lavest seed-nr.), så
    // første-runde-taperne: t6 (vant B) over t5.
    expect(ids(s)).toEqual(["t1", "t2", "t3", "t4", "t6", "t5"]);
  });
});

describe("finalRanking — cup", () => {
  it("senere utslått er bedre; innen samme runde avgjør seed", () => {
    const s = state("cup", {
      teams: teamsOf(4),
      matches: [ko("A", 1, 0, "t1", "t4", "t1"), ko("A", 1, 1, "t2", "t3", "t3"), ko("A", 2, 0, "t1", "t3", "t3")],
    });
    expect(ids(s)).toEqual(["t3", "t1", "t2", "t4"]);
  });
});

describe("finalRanking — avsluttet før finalen (B4)", () => {
  it("lag som ikke har tapt står over de som er ute, og ingen får pallplass", () => {
    const s = state("league_playoff", {
      teams: teamsOf(4),
      standings: table(["t1", "t2", "t3", "t4"]),
      // t1 røk ut i semifinalen; finalen t3–t4 ble aldri spilt.
      matches: [
        ko("A", 1, 0, "t1", "t4", "t4"),
        ko("A", 1, 1, "t2", "t3", "t3"),
        ko("A", 2, 0, "t4", "t3", null),
        ko("A", 2, 1, "t1", "t2", null),
      ],
    });
    expect(ids(s).slice(0, 2).sort()).toEqual(["t3", "t4"]);
    expect(ids(s).slice(2)).toEqual(["t1", "t2"]);
  });

  it("uspilt første runde: lag som ikke har tapt rangeres over de utslåtte", () => {
    const s = state("cup", {
      teams: teamsOf(4),
      matches: [
        ko("A", 1, 0, "t1", "t4", "t4"),
        ko("A", 1, 1, "t2", "t3", null),
        ko("A", 2, 0, "t4", null, null),
      ],
    });
    // t4 har vunnet og venter i runde 2; t2 og t3 har ikke tapt; t1 er ute.
    expect(ids(s)).toEqual(["t4", "t2", "t3", "t1"]);
    expect(championId(s)).toBeNull();
  });
});

describe("championId (B4)", () => {
  const semisOnly = (): Match[] => [
    ko("A", 1, 0, "t1", "t4", "t1"),
    ko("A", 1, 1, "t2", "t3", "t3"),
    ko("A", 2, 0, "t1", "t3", null),
  ];

  it("cup avsluttet etter semifinalene: ingen vinner (var en semifinaletaper)", () => {
    const s = state("cup", { teams: teamsOf(4), matches: semisOnly() });
    expect(championId(s)).toBeNull();
  });

  it("liga + sluttspill: tabellederen som røk ut er ikke vinner, ei heller uten finale", () => {
    const s = state("league_playoff", {
      teams: teamsOf(4),
      standings: table(["t2", "t1", "t3", "t4"]),
      matches: semisOnly(),
    });
    expect(championId(s)).toBeNull();
  });

  it("liga + sluttspill uten bygd sluttspill: ingen vinner", () => {
    const s = state("league_playoff", { teams: teamsOf(4), standings: table(["t1", "t2", "t3", "t4"]) });
    expect(championId(s)).toBeNull();
  });

  it("gruppespill: aldri den blandede tabellen", () => {
    const s = state("group_playoff", { teams: teamsOf(4), standings: table(["t1", "t2", "t3", "t4"]) });
    expect(championId(s)).toBeNull();
  });

  it("finalevinneren er mester; en spilt bronsefinale kårer ingen", () => {
    const bronzeOnly = [...semisOnly(), ko("A", 2, 1, "t4", "t2", "t2")];
    expect(championId(state("cup", { teams: teamsOf(4), matches: bronzeOnly }))).toBeNull();
    const decided = [ko("A", 1, 0, "t1", "t4", "t1"), ko("A", 1, 1, "t2", "t3", "t3"), ko("A", 2, 1, "t4", "t2", "t2"), ko("A", 2, 0, "t1", "t3", "t3")];
    expect(championId(state("cup", { teams: teamsOf(4), matches: decided }))).toBe("t3");
  });

  it("ren liga og sveitsisk: tabellederen når noe er spilt", () => {
    for (const f of ["league", "swiss"] as const) {
      expect(championId(state(f, { teams: teamsOf(3), standings: table(["t2", "t1", "t3"]) }))).toBe("t2");
      expect(championId(state(f, { teams: teamsOf(3), standings: [row("t2", 1, { played: 0 })] }))).toBeNull();
    }
  });
});

describe("finalRanking — dobbel utslag", () => {
  // 4 lag. W: t1–t4 (t1), t2–t3 (t2); W-finale t1–t2 (t1). L1: t4–t3 (t3 ut? t4 ut), L-finale t2–t3.
  const l1 = () => ko("L", 1, 0, "t4", "t3", "t3");
  const lFinal = (w: string | null) => ko("L", 2, 0, "t2", "t3", w);

  it("avgjort: mester, finaletaper, taperfinalens taper, så seneste utslåtte", () => {
    const s = state("double_elim", {
      teams: teamsOf(4),
      matches: [l1(), lFinal("t2"), ko("GF", 1, 0, "t1", "t2", "t2"), ko("GF", 2, 0, "t1", "t2", "t2")],
    });
    expect(ids(s)).toEqual(["t2", "t1", "t3", "t4"]);
  });

  it("avsluttet midt i: lag som ikke har røket ut står over de utslåtte", () => {
    const s = state("double_elim", {
      teams: teamsOf(4),
      matches: [l1(), lFinal(null), ko("GF", 1, 0, "t1", null, null)],
    });
    // t4 røk ut i L1; t1 (storfinale), t2 og t3 lever.
    expect(ids(s)).toEqual(["t1", "t2", "t3", "t4"]);
  });
});
