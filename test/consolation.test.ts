import { describe, it, expect } from "vitest";
import {
  bSeedsFromGroups,
  bSeedsFromLeague,
  buildCupConsolationSet,
  buildPlayoffSet,
  consolationOptions,
  cupConsolationFeasible,
  firstRoundMatchCount,
  pendingFinals,
  sanitiseConsolation,
} from "@/lib/tournament/consolation";
import { planDownstreamReset } from "@/lib/tournament/downstream";
import { bChampionId, championId, knockoutPodium } from "@/lib/client/view";
import { roundText } from "@/lib/tournament/printout";
import { bracketInputs, layoutBrackets } from "@/lib/tournament/bracketLayout";
import type { Match } from "@/lib/types";
import type { StateDTO } from "@/lib/dto";

const ids = (n: number, p = "t") => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);

describe("sanitiseConsolation", () => {
  it("accepts only what fits the format", () => {
    expect(sanitiseConsolation(undefined, "cup")).toBeUndefined();
    expect(sanitiseConsolation("none", "cup")).toBe("none");
    expect(sanitiseConsolation("first_round_losers", "cup")).toBe("first_round_losers");
    expect(sanitiseConsolation("b_playoff", "cup")).toBe("invalid");
    expect(sanitiseConsolation("b_playoff", "league_playoff")).toBe("b_playoff");
    expect(sanitiseConsolation("b_playoff", "group_playoff")).toBe("b_playoff");
    expect(sanitiseConsolation("first_round_losers", "league_playoff")).toBe("invalid");
    expect(sanitiseConsolation("b_playoff", "league")).toBe("invalid");
    expect(sanitiseConsolation("annet", "cup")).toBe("invalid");
    expect(sanitiseConsolation(3, "cup")).toBe("invalid");
  });
  it("offers only valid options per format", () => {
    expect(consolationOptions("cup")).toEqual(["none", "first_round_losers"]);
    expect(consolationOptions("league_playoff")).toEqual(["none", "b_playoff"]);
    expect(consolationOptions("league")).toEqual(["none"]);
  });
});

describe("B-sluttspill for resten", () => {
  it("league_playoff: 10 lag, topp 4 til A, resten (6) til B med frirunder til de to beste", () => {
    const ranked = ids(10);
    const bSeeds = bSeedsFromLeague(ranked, 4);
    expect(bSeeds).toEqual(["t5", "t6", "t7", "t8", "t9", "t10"]);
    const set = buildPlayoffSet(ranked.slice(0, 4), { bSeeds });
    expect(set.brackets.map((b) => b.id)).toEqual(["A", "B"]);
    const b = set.brackets[1].bracket;
    expect(b.rounds).toBe(3);
    const r1 = b.matches.filter((m) => m.round === 1);
    expect(
      r1
        .filter((m) => m.status === "bye")
        .map((m) => m.homeId ?? m.awayId)
        .sort(),
    ).toEqual(["t5", "t6"]);
    const r2 = b.matches.filter((m) => m.round === 2);
    expect(r2.flatMap((m) => [m.homeId, m.awayId]).filter(Boolean).sort()).toEqual(["t5", "t6"]);
    expect(set.brackets[0].bracket.matches).toHaveLength(3);
  });

  it("uten bSeeds, eller med færre enn 2 lag, bygges ingen B", () => {
    expect(buildPlayoffSet(ids(4)).brackets).toHaveLength(1);
    expect(buildPlayoffSet(ids(4), { bSeeds: ["x"] }).brackets).toHaveLength(1);
    expect(buildPlayoffSet(ids(4), { bSeeds: ["x", "y"] }).brackets).toHaveLength(2);
  });

  it("group_playoff: de som falt ut krysseedes gruppevis", () => {
    const groups = [
      ["a1", "a2", "a3", "a4"],
      ["b1", "b2", "b3"],
    ];
    expect(bSeedsFromGroups(groups, 2)).toEqual(["a3", "b3", "a4"]);
    const set = buildPlayoffSet(["a1", "b1", "a2", "b2"], { bSeeds: bSeedsFromGroups(groups, 2) });
    const b = set.brackets[1].bracket;
    const real = b.matches.filter((m) => m.round === 1 && m.status === "scheduled");
    expect(real).toHaveLength(1);
    expect([real[0].homeId, real[0].awayId].sort()).toEqual(["a4", "b3"]);
  });
});

describe("trøsterunde (cup)", () => {
  it("8 lag: 4 tapere i en egen B-brakett (semi + finale), fire loser-koblinger", () => {
    expect(cupConsolationFeasible(8)).toBe(true);
    const set = buildCupConsolationSet(ids(8));
    const b = set.brackets.find((x) => x.id === "B")!.bracket;
    expect(b.matches).toHaveLength(3);
    expect(b.matches.every((m) => m.homeId === null && m.awayId === null)).toBe(true);
    expect(set.cross).toHaveLength(4);
    expect(set.cross.every((c) => c.feed === "loser" && c.fromBracket === "A" && c.fromRound === 1)).toBe(true);
    expect(new Set(set.cross.map((c) => c.fromSlot)).size).toBe(4);
    expect(new Set(set.cross.map((c) => `${c.toRound}:${c.toSlot}:${c.toSide}`)).size).toBe(4);
  });

  it("6 lag: 2 ekte førsterundekamper → B-finale mellom de to taperne", () => {
    expect(firstRoundMatchCount(6)).toBe(2);
    const set = buildCupConsolationSet(ids(6));
    const b = set.brackets.find((x) => x.id === "B")!.bracket;
    expect(b.matches).toHaveLength(1);
    expect(b.matches[0]).toMatchObject({ round: 1, slot: 0 });
    expect(set.cross.map((c) => c.toSide).sort()).toEqual(["away", "home"]);
    // Frirunde-lagene mater ikke B.
    const aR1 = set.brackets[0].bracket.matches.filter((m) => m.round === 1);
    const fed = new Set(set.cross.map((c) => c.fromSlot));
    for (const m of aR1) expect(fed.has(m.slot)).toBe(m.status === "scheduled");
  });

  it("oddetall (7 lag, 3 tapere): frirunden i B droppes, taperen går rett til B-runde 2", () => {
    expect(firstRoundMatchCount(7)).toBe(3);
    const set = buildCupConsolationSet(ids(7));
    const b = set.brackets.find((x) => x.id === "B")!.bracket;
    expect(b.matches.some((m) => m.status === "bye")).toBe(false);
    expect(b.matches).toHaveLength(2); // én R1-kamp + finale
    expect(set.cross.filter((c) => c.toRound === 2)).toHaveLength(1);
    expect(set.cross).toHaveLength(3);
  });

  it("er ikke mulig når første runde er semifinalen (4 lag) eller < 2 tapere", () => {
    for (const n of [2, 3, 4, 5]) {
      expect(cupConsolationFeasible(n)).toBe(false);
      expect(buildCupConsolationSet(ids(n)).brackets).toHaveLength(1);
    }
    expect(cupConsolationFeasible(6)).toBe(true);
  });

  it("bronsefinalen i A påvirkes ikke", () => {
    const set = buildCupConsolationSet(ids(8), { thirdPlace: true });
    expect(set.brackets[0].bracket.matches.some((m) => m.slot === 1 && m.round === 3)).toBe(true);
  });
});

function mk(over: Partial<Match> & Pick<Match, "id">): Match {
  return {
    tournament_id: "t", phase: "playoff", round: 1, bracket_slot: 0, bracket: "A", group_no: null,
    court_id: null, queue_order: 0, scheduled_at: null, called_at: null, home_team_id: null,
    away_team_id: null, status: "scheduled", result: null, winner_team_id: null, locked_by: null,
    result_by: null, result_version: 0, updated_at: "", ...over,
  };
}

describe("ferdig først når alle brakettfinaler er ferdige", () => {
  const matches = [
    mk({ id: "af", round: 2, bracket_slot: 0, status: "done" }),
    mk({ id: "bf", bracket: "B", round: 2, bracket_slot: 0, status: "scheduled" }),
    mk({ id: "bz", round: 2, bracket_slot: 1, status: "scheduled" }),
    mk({ id: "a1", round: 1, bracket_slot: 0, status: "done" }),
  ];
  const links = [
    { from_match_id: "a1", feed: "winner" },
    { from_match_id: "a1", feed: "loser" },
  ];
  it("B-finale uspilt → venter", () => {
    expect(pendingFinals(matches, links)).toEqual(["bf"]);
  });
  it("alle ferdige → ingen igjen; bronsefinale (slot 1) blokkerer ikke", () => {
    const done = matches.map((m) => (m.id === "bf" ? { ...m, status: "done" as const } : m));
    expect(pendingFinals(done, links)).toEqual([]);
  });
});

describe("overstyring nedstrøms i B", () => {
  it("endret vinner i A-R1 nullstiller startet B-kamp (loser-kobling) og videre", () => {
    const m = [
      mk({ id: "a1", status: "done" }),
      mk({ id: "b1", bracket: "B", status: "done" }),
      mk({ id: "bf", bracket: "B", round: 2, status: "done" }),
    ];
    const links = [
      { from_match_id: "a1", to_match_id: "b1", to_slot: "home" as const },
      { from_match_id: "b1", to_match_id: "bf", to_slot: "away" as const },
    ];
    const plan = planDownstreamReset("a1", links, m);
    expect(plan.reset).toEqual(["b1", "bf"]);
    expect(plan.clearSlots).toEqual([{ matchId: "bf", slot: "away" }]);
  });
  it("endret vinner inne i B påvirker ikke A", () => {
    const m = [
      mk({ id: "b1", bracket: "B", status: "done" }),
      mk({ id: "bf", bracket: "B", round: 2, status: "done" }),
      mk({ id: "af", round: 2, status: "done" }),
    ];
    const plan = planDownstreamReset("b1", [{ from_match_id: "b1", to_match_id: "bf", to_slot: "home" }], m);
    expect(plan.reset).toEqual(["bf"]);
  });
});

describe("visning: A-mester, B-vinner, rundetekst, layout", () => {
  const matches = [
    mk({ id: "af", round: 2, status: "done", home_team_id: "x", away_team_id: "y", winner_team_id: "x" }),
    mk({ id: "a1", round: 1, status: "done" }),
    mk({ id: "bf", bracket: "B", round: 3, status: "done", home_team_id: "p", away_team_id: "q", winner_team_id: "q" }),
  ];
  const state = { tournament: { id: "t" }, teams: [], courts: [], matches, standings: [] } as unknown as StateDTO;

  it("mesteren er A-vinneren selv om B har flere runder", () => {
    expect(championId(state)).toBe("x");
    expect(knockoutPodium(matches.filter((m) => m.bracket !== "B"))[0]).toBe("x");
    expect(bChampionId(matches)).toBe("q");
    expect(bChampionId(matches.filter((m) => m.bracket !== "B"))).toBeNull();
  });
  it("B-kamper får B-tekst på kort", () => {
    expect(roundText(matches[2], 2)).toMatch(/B-sluttspill/);
  });
  it("layout: to braketter, med ekte koblinger og etikett på tvers", () => {
    const ms = [
      mk({ id: "a1", round: 1, bracket_slot: 0 }),
      mk({ id: "a2", round: 1, bracket_slot: 1 }),
      mk({ id: "af", round: 2, bracket_slot: 0 }),
      mk({ id: "bf", bracket: "B", round: 1, bracket_slot: 0 }),
    ];
    const links = [
      { from_match_id: "a1", to_match_id: "af", to_slot: "home" as const, feed: "winner" as const },
      { from_match_id: "a2", to_match_id: "af", to_slot: "away" as const, feed: "winner" as const },
      { from_match_id: "a1", to_match_id: "bf", to_slot: "home" as const, feed: "loser" as const },
      { from_match_id: "a2", to_match_id: "bf", to_slot: "away" as const, feed: "loser" as const },
    ];
    const inputs = bracketInputs(ms, links, { A: "A-sluttspill", B: "B-sluttspill" });
    expect(inputs.map((i) => i.id)).toEqual(["A", "B"]);
    const [a, b] = layoutBrackets(inputs);
    expect(a.rounds).toHaveLength(2);
    expect(a.connectors).toHaveLength(2);
    expect(b.rounds).toHaveLength(1);
    expect(b.rounds[0].nodes[0].home?.label).toMatch(/Taper av/);
  });
  it("uten koblinger faller layout tilbake til utledede", () => {
    const ms = [mk({ id: "a1", round: 1 }), mk({ id: "a2", round: 1, bracket_slot: 1 }), mk({ id: "af", round: 2 })];
    const [a] = layoutBrackets(bracketInputs(ms, []));
    expect(a.connectors).toHaveLength(2);
  });
});
