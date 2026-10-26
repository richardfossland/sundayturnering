import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Match, ScheduleConfig } from "@/lib/types";

// L4/B2: bronsefinalen settes FØR finalen i køen og tidsplanen (finalen er dagens
// siste kamp, og turneringen avsluttes først når begge er avgjort). Finalen
// identifiseres fortsatt med bracket_slot 0 (champion/view/narrate).

type Row = Record<string, unknown>;
let matches: Row[] = [];
let links: Row[] = [];

vi.mock("@/lib/server/store", () => ({
  db: () => ({
    from: (table: string) => ({
      insert: async (rows: Row[] | Row) => {
        if (table === "matches") matches = rows as Row[];
        if (table === "bracket_links") links = rows as Row[];
        return { error: null };
      },
    }),
  }),
  getMatches: async () =>
    matches.map((r, i) => ({
      id: `id${i}`,
      phase: "playoff",
      round: r.round,
      bracket_slot: r.bracket_slot,
      bracket: r.bracket ?? "A",
    })),
}));

import { buildCupMatches } from "@/lib/server/build";
import { buildPlayoffSet, bracketPlayOrder, pendingFinals } from "@/lib/tournament/consolation";
import { estimateEnd } from "@/lib/tournament/estimate";
import { championId } from "@/lib/tournament/champion";
import { knockoutPodium } from "@/lib/client/view";
import { toMatchDTO } from "@/lib/dto";

const schedule: ScheduleConfig = {
  startAt: "2026-10-25T09:00:00.000Z",
  matchMinutes: 10,
  breakMinutes: 0,
  minRestMinutes: 0,
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
const byQueue = () => [...matches].sort((x, y) => (x.queue_order as number) - (y.queue_order as number));

beforeEach(() => {
  matches = [];
  links = [];
});

describe("bronsefinale før finale i køen", () => {
  it("bracketPlayOrder: runde 2 = bronse (slot 1) så finale (slot 0)", () => {
    const order = bracketPlayOrder(buildPlayoffSet(ids(4), { thirdPlace: true })).map(
      ({ id, m }) => `${id}${m.round}:${m.slot}`,
    );
    expect(order).toEqual(["A1:0", "A1:1", "A2:1", "A2:0"]);
  });

  it("uten bronsefinale er rekkefølgen som før", () => {
    const order = bracketPlayOrder(buildPlayoffSet(ids(4))).map(({ id, m }) => `${id}${m.round}:${m.slot}`);
    expect(order).toEqual(["A1:0", "A1:1", "A2:0"]);
  });

  it("8 lag: kvartfinaler uendret, bronse før finale i siste runde", () => {
    const order = bracketPlayOrder(buildPlayoffSet(ids(8), { thirdPlace: true })).map(
      ({ m }) => `${m.round}:${m.slot}`,
    );
    expect(order).toEqual(["1:0", "1:1", "1:2", "1:3", "2:0", "2:1", "3:1", "3:0"]);
  });

  it("buildCupMatches (uten tidsplan): bronse har lavere queue_order enn finalen", async () => {
    await buildCupMatches("t", ids(4), ["c1", "c2"], { thirdPlace: true });
    const q = byQueue().map((r) => `${r.round}:${r.bracket_slot}`);
    expect(q).toEqual(["1:0", "1:1", "2:1", "2:0"]);
    // Koblingene følger radene (ikke køen): to vinner- og to taper-koblinger.
    expect(links.filter((l) => l.feed === "loser")).toHaveLength(2);
    expect(links.filter((l) => l.feed === "winner")).toHaveLength(2);
  });

  it("buildCupMatches (med tidsplan, én bane): bronse spilles før finalen", async () => {
    await buildCupMatches("t", ids(4), ["c1"], { thirdPlace: true, schedule });
    const at = (round: number, slot: number) =>
      Date.parse(matches.find((r) => r.round === round && r.bracket_slot === slot)!.scheduled_at as string);
    expect(at(2, 1)).toBeLessThan(at(2, 0));
  });

  it("estimatet bruker samme rekkefølge (sluttid uendret for én bane: 4 kamper)", () => {
    const e = estimateEnd({ format: "cup", teamCount: 4, courtCount: 1, schedule, thirdPlace: true });
    expect(e.matchCount).toBe(4);
    expect(e.endsAt).toBe("2026-10-25T09:40:00.000Z");
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

describe("pendingFinals med bronsefinale (fallback-stien speiler migrasjon 0020)", () => {
  const ms = [
    mk({ id: "s1", round: 1, bracket_slot: 0, status: "done" }),
    mk({ id: "s2", round: 1, bracket_slot: 1, status: "done" }),
    mk({ id: "fin", round: 2, bracket_slot: 0, status: "done" }),
    mk({ id: "bz", round: 2, bracket_slot: 1, status: "scheduled" }),
  ];
  const links = [
    { from_match_id: "s1", to_match_id: "fin", feed: "winner" },
    { from_match_id: "s2", to_match_id: "fin", feed: "winner" },
    { from_match_id: "s1", to_match_id: "bz", feed: "loser" },
    { from_match_id: "s2", to_match_id: "bz", feed: "loser" },
  ];
  it("finalen ferdig, bronse ikke → bronse venter", () => {
    expect(pendingFinals(ms, links)).toEqual(["bz"]);
  });
  it("bronse ferdig, finale ikke → finalen venter", () => {
    const m2 = ms.map((m) => (m.id === "fin" ? { ...m, status: "scheduled" as const } : m.id === "bz" ? { ...m, status: "done" as const } : m));
    expect(pendingFinals(m2, links)).toEqual(["fin"]);
  });
  it("begge ferdige → ingenting igjen", () => {
    expect(pendingFinals(ms.map((m) => ({ ...m, status: "done" as const })), links)).toEqual([]);
  });
  it("slot 1 i en B-brakett med vei videre er ikke en bronsefinale", () => {
    const b = [mk({ id: "b1", bracket: "B", round: 1, bracket_slot: 1, status: "scheduled" })];
    expect(pendingFinals(b, [{ from_match_id: "b1", to_match_id: "bf", feed: "winner" }])).toEqual([]);
  });
});

describe("klienten er enig: finalen = bracket_slot 0, også når bronse er spilt først", () => {
  const base = [
    mk({ id: "s1", round: 1, bracket_slot: 0, home_team_id: "a", away_team_id: "d", status: "done", winner_team_id: "a" }),
    mk({ id: "s2", round: 1, bracket_slot: 1, home_team_id: "b", away_team_id: "c", status: "done", winner_team_id: "b" }),
    mk({ id: "bz", round: 2, bracket_slot: 1, home_team_id: "d", away_team_id: "c", status: "done", winner_team_id: "c" }),
    mk({ id: "fin", round: 2, bracket_slot: 0, home_team_id: "a", away_team_id: "b", status: "scheduled" }),
  ];
  const state = (matches: Match[]) =>
    ({ tournament: { format: "cup", status: "playoff" }, matches, standings: [], teams: [] }) as unknown as Parameters<typeof championId>[0];

  it("bronsevinneren kåres aldri som mester mens finalen står igjen", () => {
    expect(championId(state(base))).toBeNull();
    expect(knockoutPodium(base)).toEqual([]);
  });
  it("finalen ferdig → mester = finalens vinner, pallen har alle fire", () => {
    const done = base.map((m) => (m.id === "fin" ? { ...m, status: "done" as const, winner_team_id: "b" } : m));
    expect(championId(state(done))).toBe("b");
    expect(knockoutPodium(done)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("toMatchDTO", () => {
  it("fjerner precall_court_id (intern bokføring) men beholder resten", () => {
    const m = { ...mk({ id: "x", court_id: "c2" }), precall_court_id: "c1" };
    const dto = toMatchDTO(m) as Record<string, unknown>;
    expect("precall_court_id" in dto).toBe(false);
    expect(dto.court_id).toBe("c2");
  });
  it("er uendret når kolonnen ikke finnes (før migrasjonen)", () => {
    expect(toMatchDTO(mk({ id: "x" })).id).toBe("x");
  });
});
