import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateInput } from "@/lib/server/build";

// Seam test: the wizard → /api/tournament → lib/server/build hand-off. Every
// option the wizard can set must survive this route. The regression this pins:
// the route whitelisted only three formats (so "Gruppespill" got a 400) and
// rebuilt `config` from just playoffSize/roundRobinDouble (so the bronze-final
// checkbox and the group settings never reached the database) — while the
// pure logic and the /api/dev/seed path, which call build.ts directly, were
// green all along.

let captured: CreateInput | null = null;
vi.mock("@/lib/server/build", () => ({
  createTournament: async (input: CreateInput) => {
    captured = input;
    return {
      id: "tid",
      control_code: "123456",
      board_code: "BLAA-KT",
      organiser_code: "ROED-HU",
    };
  },
}));
vi.mock("@/lib/supabase/auth-server", () => ({
  createAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

import { POST } from "@/app/api/tournament/route";
import { __resetRateLimiter } from "@/lib/server/http";

function teams(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: `Lag ${i + 1}`,
    colour: "#111",
    logo_url: null,
    members: [],
  }));
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/tournament", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const scoring = {
  profile: "simple",
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  allowDraw: false,
};

describe("POST /api/tournament — wizard config survives the route", () => {
  beforeEach(() => {
    captured = null;
    __resetRateLimiter(); // create is rate-limited per IP ("local" here)
  });

  it("accepts group_playoff and carries groupCount/advancePerGroup/thirdPlace", async () => {
    const res = await post({
      title: "Gruppespill",
      sport_label: "Fotball",
      format: "group_playoff",
      scoring,
      parallelism: "sequential",
      config: { playoffSize: 0, roundRobinDouble: false, thirdPlace: true, groupCount: 3, advancePerGroup: 2 },
      teams: teams(9),
      courts: [],
    });
    expect(res.status).toBe(200);
    expect(captured!.format).toBe("group_playoff");
    expect(captured!.config).toMatchObject({ groupCount: 3, advancePerGroup: 2, thirdPlace: true });
  });

  it("carries consolation through for fitting formats; rejects mismatches and junk", async () => {
    const base = {
      title: "x", sport_label: "", scoring, parallelism: "sequential", courts: [],
    };
    const cup = await post({
      ...base, format: "cup", teams: teams(8),
      config: { playoffSize: 0, roundRobinDouble: false, consolation: "first_round_losers" },
    });
    expect(cup.status).toBe(200);
    expect(captured!.config.consolation).toBe("first_round_losers");

    const lp = await post({
      ...base, format: "league_playoff", teams: teams(10),
      config: { playoffSize: 4, roundRobinDouble: false, consolation: "b_playoff" },
    });
    expect(lp.status).toBe(200);
    expect(captured!.config.consolation).toBe("b_playoff");

    const none = await post({
      ...base, format: "league_playoff", teams: teams(10),
      config: { playoffSize: 4, roundRobinDouble: false },
    });
    expect(none.status).toBe(200);
    expect(captured!.config).not.toHaveProperty("consolation");

    for (const [format, consolation] of [
      ["cup", "b_playoff"],
      ["league", "b_playoff"],
      ["league_playoff", "first_round_losers"],
      ["cup", "bogus"],
    ]) {
      const res = await post({
        ...base, format, teams: teams(8),
        config: { playoffSize: 4, roundRobinDouble: false, consolation },
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "ugyldig_ekstra_sluttspill" });
    }
  });

  it("carries a valid schedule through, and omits it when not sent", async () => {
    const base = {
      title: "x", sport_label: "", format: "league", scoring,
      parallelism: "sequential", teams: teams(4), courts: [],
    };
    await post({ ...base, config: { playoffSize: 0, roundRobinDouble: false } });
    expect(captured!.config).not.toHaveProperty("schedule");

    const res = await post({
      ...base,
      config: {
        playoffSize: 0, roundRobinDouble: false,
        schedule: { startAt: "2026-10-25T09:00:00Z", matchMinutes: 12, breakMinutes: 3, minRestMinutes: 10 },
      },
    });
    expect(res.status).toBe(200);
    expect(captured!.config.schedule).toEqual({
      startAt: "2026-10-25T09:00:00.000Z", matchMinutes: 12, breakMinutes: 3, minRestMinutes: 10,
    });
  });

  it("carries a tiebreak preset/array, and rejects unknown ones with 400", async () => {
    const base = {
      title: "x", sport_label: "", format: "league", scoring,
      parallelism: "sequential", teams: teams(4), courts: [],
    };
    await post({ ...base, config: { playoffSize: 0, roundRobinDouble: false } });
    expect(captured!.config).not.toHaveProperty("tiebreak");

    let res = await post({ ...base, config: { playoffSize: 0, roundRobinDouble: false, tiebreak: "uefa" } });
    expect(res.status).toBe(200);
    expect(captured!.config.tiebreak).toBe("uefa");

    res = await post({ ...base, config: { playoffSize: 0, roundRobinDouble: false, tiebreak: ["points", "h2h_diff", "name"] } });
    expect(res.status).toBe(200);
    expect(captured!.config.tiebreak).toEqual(["points", "h2h_diff", "name"]);

    for (const bad of ["fifa", ["points", "bogus"], [], 5]) {
      res = await post({ ...base, config: { playoffSize: 0, roundRobinDouble: false, tiebreak: bad } });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("ugyldig_tiebreak");
    }
  });

  it("rejects an invalid schedule with 400", async () => {
    const res = await post({
      title: "x", sport_label: "", format: "league", scoring,
      parallelism: "sequential", teams: teams(4), courts: [],
      config: { playoffSize: 0, roundRobinDouble: false, schedule: { startAt: "ikke-en-dato", matchMinutes: 10 } },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ugyldig_tidsplan");
    expect(captured).toBeNull();
  });

  it("carries thirdPlace for league_playoff and cup", async () => {
    for (const format of ["league_playoff", "cup"] as const) {
      const res = await post({
        title: "x",
        sport_label: "",
        format,
        scoring,
        parallelism: "sequential",
        config: { playoffSize: 4, roundRobinDouble: false, thirdPlace: true },
        teams: teams(6),
        courts: [],
      });
      expect(res.status).toBe(200);
      expect(captured!.config.thirdPlace).toBe(true);
      expect(captured!.config.playoffSize).toBe(4);
    }
  });

  it("does not leak group keys into non-group formats", async () => {
    await post({
      title: "x",
      sport_label: "",
      format: "league",
      scoring,
      parallelism: "sequential",
      config: { playoffSize: 0, roundRobinDouble: false, groupCount: 4, advancePerGroup: 2 },
      teams: teams(4),
      courts: [],
    });
    expect(captured!.config).not.toHaveProperty("groupCount");
    expect(captured!.config.thirdPlace).toBe(false);
  });

  it("rejects more groups than the teams can fill", async () => {
    const res = await post({
      title: "x",
      sport_label: "",
      format: "group_playoff",
      scoring,
      parallelism: "sequential",
      config: { playoffSize: 0, roundRobinDouble: false, groupCount: 4, advancePerGroup: 1 },
      teams: teams(6),
      courts: [],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("for_mange_grupper");
    expect(captured).toBeNull();
  });

  it("rejects a missing or unknown scoring profile instead of throwing", async () => {
    const base = {
      title: "x",
      sport_label: "",
      format: "league",
      parallelism: "sequential",
      config: { playoffSize: 0, roundRobinDouble: false },
      teams: teams(2),
      courts: [],
    };
    expect((await post(base)).status).toBe(400);
    expect((await post({ ...base, scoring: { profile: "golf" } })).status).toBe(400);
    expect(captured).toBeNull();
  });

  it("still rejects an unknown format", async () => {
    const res = await post({
      title: "x",
      sport_label: "",
      format: "bogus",
      scoring,
      parallelism: "sequential",
      config: {},
      teams: teams(2),
      courts: [],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ugyldig_format");
  });

  // An off-size request clamps DOWN to the largest bracket that fits. It used
  // to become 0 — a "Liga + sluttspill" whose playoff could never start
  // (3 teams at the wizard's default of 4 sent 3).
  it.each([
    [6, 8, 4],
    [3, 3, 2],
    [4, 3, 2],
    [8, 5, 4],
    [16, 16, 16],
    ["x", 8, 0],
    [1, 8, 0],
  ])("playoffSize %s with %i teams → %i", async (requested, teamCount, expected) => {
    await post({
      title: "x",
      sport_label: "",
      format: "league_playoff",
      scoring,
      parallelism: "sequential",
      config: { playoffSize: requested, roundRobinDouble: false },
      teams: teams(teamCount),
      courts: [],
    });
    expect(captured!.config.playoffSize).toBe(expected);
  });

  it("non-string team names and malformed courts are a 400 / cleaned, not a 500", async () => {
    const bad = await post({
      title: "x",
      sport_label: "",
      format: "league",
      scoring,
      parallelism: "parallel",
      config: {},
      teams: [{ name: 42 }, { name: "B" }],
      courts: [],
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("lag_mangler_navn");

    await post({
      title: "x",
      sport_label: "",
      format: "league",
      scoring,
      parallelism: "parallel",
      config: {},
      teams: teams(2),
      courts: [{ name: "  Hall A " }, null, { name: 7 }],
    });
    expect(captured!.courts).toEqual([{ name: "Hall A" }, { name: "Bane 2" }, { name: "Bane 3" }]);
  });

  it("swiss: bærer antall runder, defaulter til ceil(log2 N), avviser 0 / N / for få lag", async () => {
    const base = { title: "x", sport_label: "", format: "swiss", scoring, parallelism: "sequential", courts: [] };
    const cfg = (swiss?: unknown) => ({ playoffSize: 0, roundRobinDouble: false, ...(swiss ? { swiss } : {}) });
    const ok = await post({ ...base, teams: teams(7), config: cfg({ rounds: 4 }) });
    expect(ok.status).toBe(200);
    expect(captured!.config.swiss).toEqual({ rounds: 4 });
    await post({ ...base, teams: teams(8), config: cfg() });
    expect(captured!.config.swiss).toEqual({ rounds: 3 });
    for (const rounds of [0, 8, 1.5, "3"]) {
      const res = await post({ ...base, teams: teams(8), config: cfg({ rounds }) });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("ugyldig_antall_runder");
    }
    const few = await post({ ...base, teams: teams(2), config: cfg() });
    expect((await few.json()).error).toBe("for_fa_lag_swiss");
  });
});
