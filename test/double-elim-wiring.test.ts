import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateInput } from "@/lib/server/build";
import type { Match, ScheduleConfig } from "@/lib/types";
import type { StateDTO } from "@/lib/dto";

// Skjøtene rundt dobbel utslag: byggeren skriver W/L/GF + koblinger, tidsplanen
// respekterer W→L-avhengigheter, overstyring nullstiller riktig nedstrøms, braketten
// får «Taper av V-SF1»-etiketter, og mester/pall/rangering leses fra GF.

type Row = Record<string, unknown>;
let matches: Row[] = [];
let links: Row[] = [];
let captured: CreateInput | null = null;

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
vi.mock("@/lib/supabase/auth-server", () => ({
  createAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

import { buildDoubleElimMatches } from "@/lib/server/build";
import { planDownstreamReset } from "@/lib/tournament/downstream";
import { bracketInputs, layoutBrackets } from "@/lib/tournament/bracketLayout";
import { pendingFinals } from "@/lib/tournament/consolation";
import { doubleElimOutcome, doubleElimOrder } from "@/lib/tournament/doubleElim";
import { championId, finalRanking } from "@/lib/client/view";
import { roundText } from "@/lib/tournament/printout";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
const T0 = Date.parse("2026-10-25T09:00:00.000Z");
const schedule: ScheduleConfig = {
  startAt: new Date(T0).toISOString(),
  matchMinutes: 10,
  breakMinutes: 0,
  minRestMinutes: 0,
};
const idOfRow = (r: Row) => `id${matches.indexOf(r)}`;
const rowOf = (bracket: string, round: number, slot: number) =>
  matches.find((r) => (r.bracket ?? "A") === bracket && r.round === round && r.bracket_slot === slot)!;

beforeEach(() => {
  matches = [];
  links = [];
  captured = null;
});

describe("buildDoubleElimMatches", () => {
  it("8 lag: W/L/GF-rader med riktig brakett, og 2N−1 spillbare kamper", async () => {
    await buildDoubleElimMatches("t", ids(8), []);
    expect(matches.filter((r) => r.bracket === "W")).toHaveLength(7);
    expect(matches.filter((r) => r.bracket === "L")).toHaveLength(6);
    expect(matches.filter((r) => r.bracket === "GF")).toHaveLength(2);
    expect(matches.filter((r) => r.status !== "bye")).toHaveLength(2 * 8 - 1);
    // Taper-koblinger: W1 (4) + W2 (2) + W3 (1) inn i L, pluss taperen av storfinalen → omkampen.
    expect(links.filter((l) => l.feed === "loser")).toHaveLength(7 + 1);
  });

  it("uten omkamp: bare én GF-rad", async () => {
    await buildDoubleElimMatches("t", ids(4), [], { grandFinalReset: false });
    expect(matches.filter((r) => r.bracket === "GF")).toHaveLength(1);
  });

  it("kø: W-runde før L-runden den mater, GF sist", async () => {
    await buildDoubleElimMatches("t", ids(8), []);
    const q = (b: string, r: number) => (rowOf(b, r, 0).queue_order as number);
    expect(q("W", 1)).toBeLessThan(q("L", 1));
    expect(q("L", 1)).toBeLessThan(q("W", 2));
    expect(q("W", 2)).toBeLessThan(q("L", 2));
    expect(q("L", 2)).toBeLessThan(q("L", 3));
    expect(q("W", 3)).toBeLessThan(q("L", 4));
    expect(q("L", 4)).toBeLessThan(q("GF", 1));
    expect(q("GF", 1)).toBeLessThan(q("GF", 2));
    expect(doubleElimOrder("L", 3)).toBeGreaterThan(doubleElimOrder("L", 2));
  });

  it("tidsplan: hver kamp starter etter kampene som mater den (W → L → GF)", async () => {
    await buildDoubleElimMatches("t", ids(8), ["c1", "c2"], { schedule });
    const start = (r: Row) => Date.parse(r.scheduled_at as string);
    const byId = new Map(matches.map((r) => [idOfRow(r), r]));
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      const from = byId.get(l.from_match_id as string)!;
      const to = byId.get(l.to_match_id as string)!;
      if (!from.scheduled_at || !to.scheduled_at) continue; // frirunder får ikke tid
      expect(start(to), `${from.bracket}${from.round} → ${to.bracket}${to.round}`).toBeGreaterThanOrEqual(
        start(from) + 10 * 60_000,
      );
    }
  });

  it("6 lag: frirunder i W1 får ikke tid, og alle ekte kamper har tid", async () => {
    await buildDoubleElimMatches("t", ids(6), [], { schedule });
    for (const r of matches)
      expect(r.scheduled_at === null).toBe(r.status === "bye");
  });
});

describe("nedstrøms nullstilling over W, L og GF", () => {
  it("overstyrt W-finale (spilt) nullstiller L-finalen og storfinalen", async () => {
    await buildDoubleElimMatches("t", ids(4), []);
    const status = (b: string, r: number) => (rowOf(b, r, 0).status = "done");
    status("W", 2);
    status("L", 2);
    status("GF", 1);
    const state = matches.map((r) => ({ id: idOfRow(r), status: r.status as Match["status"] }));
    const plan = planDownstreamReset(idOfRow(rowOf("W", 2, 0)), links as never, state);
    // Taperen av W-finalen går til L-finalen (spilt) og vinneren til storfinalen (spilt).
    expect(new Set(plan.reset)).toEqual(
      new Set([idOfRow(rowOf("L", 2, 0)), idOfRow(rowOf("GF", 1, 0))]),
    );
  });

  it("overstyrt W1-kamp når L1 er spilt: L1 og alt L1 har mate nullstilles, slotter tømmes", async () => {
    await buildDoubleElimMatches("t", ids(4), []);
    rowOf("L", 1, 0).status = "done";
    rowOf("L", 2, 0).status = "done";
    const state = matches.map((r) => ({ id: idOfRow(r), status: r.status as Match["status"] }));
    const plan = planDownstreamReset(idOfRow(rowOf("W", 1, 0)), links as never, state);
    expect(plan.reset).toContain(idOfRow(rowOf("L", 1, 0)));
    expect(plan.reset).toContain(idOfRow(rowOf("L", 2, 0)));
    // Slotten L2 fikk fra L1 (vinneren) blir ukjent.
    expect(plan.clearSlots.some((s) => s.matchId === idOfRow(rowOf("L", 2, 0)))).toBe(true);
  });

  it("overstyrt storfinale når omkampen er spilt: omkampen nullstilles", async () => {
    await buildDoubleElimMatches("t", ids(4), []);
    rowOf("GF", 1, 0).status = "done";
    rowOf("GF", 2, 0).status = "done";
    const state = matches.map((r) => ({ id: idOfRow(r), status: r.status as Match["status"] }));
    const plan = planDownstreamReset(idOfRow(rowOf("GF", 1, 0)), links as never, state);
    expect(plan.reset).toEqual([idOfRow(rowOf("GF", 2, 0))]);
  });
});

describe("brakettvisning", () => {
  it("W, L, GF i rekkefølge, med «Taper av V-SF1»-etiketter og norske rundenavn", async () => {
    await buildDoubleElimMatches("t", ids(8), []);
    const playoff = matches.map((r) => ({
      id: idOfRow(r),
      round: r.round as number,
      bracket_slot: r.bracket_slot as number,
      bracket: r.bracket as string,
    }));
    const linkRows = links.map((l) => ({
      from_match_id: l.from_match_id as string,
      to_match_id: l.to_match_id as string,
      to_slot: l.to_slot as "home" | "away",
      feed: l.feed as "winner" | "loser",
    }));
    const inputs = bracketInputs(playoff, linkRows, { W: "Vinnerbrakett", L: "Taperbrakett", GF: "Finale" });
    expect(inputs.map((i) => i.id)).toEqual(["W", "L", "GF"]);
    const layouts = layoutBrackets(inputs);
    const [w, l, gf] = layouts;
    expect(w.rounds.map((r) => r.name)).toEqual(["Kvartfinale", "Semifinale", "Finale"]);
    expect(l.rounds.map((r) => r.name)).toEqual([
      "Taperrunde 1", "Taperrunde 2", "Taperrunde 3", "Taperfinale",
    ]);
    expect(gf.rounds.map((r) => r.name)).toEqual(["Finale", "Omkamp"]);
    // L2 kamp 0 mates av taperen av en W-semifinale.
    const l2 = l.rounds.find((r) => r.round === 2)!.nodes;
    const labels = l2.flatMap((n) => [n.home?.label, n.away?.label]);
    expect(labels).toContain("Taper av V-SF1");
    expect(labels).toContain("Taper av V-SF2");
    // Storfinalen venter på «Vinner av V-F» og «Vinner av T-F».
    const gf1 = gf.rounds[0].nodes[0];
    expect(gf1.home?.label).toBe("Vinner av V-F");
    expect(gf1.away?.label).toBe("Vinner av T-F");
    // Ingen overlapp i en kolonne (monotone y).
    for (const lay of layouts)
      for (const r of lay.rounds)
        r.nodes.reduce((prev, n) => {
          expect(n.y).toBeGreaterThanOrEqual(prev + 1);
          return n.y;
        }, -Infinity);
  });
});

describe("pendingFinals med omkamp", () => {
  const base = { phase: "playoff", bracket_slot: 0 };
  const gf = (round: number, status: string, extra: object = {}) => ({
    ...base, id: `gf${round}`, bracket: "GF", round, status, ...extra,
  });
  const gfLink = [{ from_match_id: "gf1", feed: "winner" }, { from_match_id: "gf1", feed: "loser" }];

  it("omkampen er finalen: uavgjort til den er spilt", () => {
    expect(pendingFinals([gf(1, "done", { home_team_id: "a", winner_team_id: "b" }), gf(2, "scheduled")], gfLink)).toEqual(["gf2"]);
  });
  it("W-laget vant storfinalen: omkampen teller ikke som uspilt", () => {
    expect(pendingFinals([gf(1, "done", { home_team_id: "a", winner_team_id: "a" }), gf(2, "scheduled")], gfLink)).toEqual([]);
  });
  it("uten omkamp er storfinalen finalen", () => {
    expect(pendingFinals([gf(1, "scheduled")], [])).toEqual(["gf1"]);
    expect(pendingFinals([gf(1, "done")], [])).toEqual([]);
  });
});

function mk(p: Partial<Match> & { id: string }): Match {
  return {
    tournament_id: "t", phase: "playoff", round: 1, bracket_slot: 0, bracket: "W", group_no: null,
    court_id: null, queue_order: 0, scheduled_at: null, called_at: null, home_team_id: null,
    away_team_id: null, status: "done", result: null, winner_team_id: null, locked_by: null,
    result_by: null, result_version: 0, updated_at: "", ...p,
  } as Match;
}

describe("mester, pall og rangering", () => {
  const teams = ["a", "b", "c", "d"].map((id, i) => ({
    id, tournament_id: "t", name: id.toUpperCase(), colour: "#000", logo_url: null,
    seed: i + 1, sort_order: i, members: [], group_no: null,
  }));
  const stateOf = (ms: Match[]) =>
    ({
      tournament: { format: "double_elim", status: "playoff" },
      teams, matches: ms, standings: [], links: [],
    }) as unknown as StateDTO;
  const lFinal = mk({ id: "lf", bracket: "L", round: 2, home_team_id: "c", away_team_id: "b", winner_team_id: "b" });
  const l1 = mk({ id: "l1", bracket: "L", round: 1, home_team_id: "d", away_team_id: "c", winner_team_id: "c" });

  it("ingen mester før storfinalen er avgjort", () => {
    const gf1 = mk({ id: "g1", bracket: "GF", round: 1, home_team_id: "a", away_team_id: "b", status: "scheduled" });
    expect(championId(stateOf([lFinal, gf1]))).toBeNull();
    expect(doubleElimOutcome([lFinal, gf1])).toBeNull();
  });

  it("W-laget vinner storfinalen (omkamp utgått): 1 = a, 2 = b, 3 = taperen av taperfinalen", () => {
    const gf1 = mk({ id: "g1", bracket: "GF", round: 1, home_team_id: "a", away_team_id: "b", winner_team_id: "a" });
    const gf2 = mk({ id: "g2", bracket: "GF", round: 2, home_team_id: "a", away_team_id: "b", winner_team_id: "a", status: "bye" });
    const s = stateOf([l1, lFinal, gf1, gf2]);
    expect(championId(s)).toBe("a");
    expect(finalRanking(s).map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("L-laget vinner omkampen: omkampens vinner er mester", () => {
    const gf1 = mk({ id: "g1", bracket: "GF", round: 1, home_team_id: "a", away_team_id: "b", winner_team_id: "b" });
    const gf2 = mk({ id: "g2", bracket: "GF", round: 2, home_team_id: "b", away_team_id: "a", winner_team_id: "b" });
    const s = stateOf([l1, lFinal, gf1, gf2]);
    expect(championId(s)).toBe("b");
    expect(finalRanking(s).slice(0, 2).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("omkamp ikke spilt ennå: ingen mester", () => {
    const gf1 = mk({ id: "g1", bracket: "GF", round: 1, home_team_id: "a", away_team_id: "b", winner_team_id: "b" });
    const gf2 = mk({ id: "g2", bracket: "GF", round: 2, home_team_id: "b", away_team_id: "a", status: "scheduled" });
    expect(championId(stateOf([lFinal, gf1, gf2]))).toBeNull();
  });

  it("utskrift: W/L/GF får brakettnavn", () => {
    expect(roundText(mk({ id: "x", bracket: "W", round: 2 }), 0)).toBe("Vinnerbrakett · Runde 2");
    expect(roundText(mk({ id: "x", bracket: "L", round: 3 }), 0)).toBe("Taperbrakett · Runde 3");
    expect(roundText(mk({ id: "x", bracket: "GF", round: 2 }), 0)).toBe("Omkamp");
  });
});

describe("POST /api/tournament med dobbel utslag", () => {
  async function post(body: unknown) {
    vi.doMock("@/lib/server/build", () => ({
      createTournament: async (input: CreateInput) => {
        captured = input;
        return { id: "tid", control_code: "1", board_code: "b", organiser_code: "o" };
      },
    }));
    vi.resetModules();
    const { POST } = await import("@/app/api/tournament/route");
    const { __resetRateLimiter } = await import("@/lib/server/http");
    __resetRateLimiter();
    return POST(
      new Request("http://localhost/api/tournament", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }
  const teamsOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `Lag ${i + 1}`, colour: "#111", logo_url: null, members: [] }));
  const base = {
    title: "x", sport_label: "", parallelism: "sequential", courts: [], format: "double_elim",
    scoring: { profile: "simple", pointsWin: 3, pointsDraw: 1, pointsLoss: 0, allowDraw: false },
  };

  it("godtar 3–32 lag og bærer omkamp-valget (default ja)", async () => {
    const a = await post({ ...base, teams: teamsOf(6), config: { playoffSize: 0, roundRobinDouble: false } });
    expect(a.status).toBe(200);
    expect(captured!.config.doubleElim).toEqual({ grandFinalReset: true });
    const b = await post({
      ...base, teams: teamsOf(6),
      config: { playoffSize: 0, roundRobinDouble: false, doubleElim: { grandFinalReset: false } },
    });
    expect(b.status).toBe(200);
    expect(captured!.config.doubleElim).toEqual({ grandFinalReset: false });
  });

  it("avviser for få og for mange lag", async () => {
    const few = await post({ ...base, teams: teamsOf(2), config: { playoffSize: 0, roundRobinDouble: false } });
    expect(few.status).toBe(400);
    await expect(few.json()).resolves.toEqual({ error: "for_fa_lag_dobbel" });
    const many = await post({ ...base, teams: teamsOf(33), config: { playoffSize: 0, roundRobinDouble: false } });
    expect(many.status).toBe(400);
    await expect(many.json()).resolves.toEqual({ error: "for_mange_lag_dobbel" });
  });
});
