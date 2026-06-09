import { ok, fail, readJson } from "@/lib/server/http";
import { createTournament } from "@/lib/server/build";
import { defaultScoringConfig } from "@/lib/tournament/scoring";
import type { Format, ScoringProfileKey } from "@/lib/types";

// POST /api/dev/seed — test seam. Creates a sample tournament so the rig/smoke
// tests can run without driving the wizard. Disabled in production.
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return fail(404, "ikke_tilgjengelig");

  const body =
    (await readJson<{
      teams?: number;
      format?: Format;
      profile?: ScoringProfileKey;
      parallel?: boolean;
      courts?: number;
      playoffSize?: 2 | 4 | 8;
    }>(req)) ?? {};

  const n = Math.max(2, Math.min(16, body.teams ?? 6));
  const format = body.format ?? "league";
  const profile = body.profile ?? "simple";
  const parallel = !!body.parallel;
  const courtN = Math.max(1, body.courts ?? 2);

  const result = await createTournament({
    title: "Testturnering",
    sport_label: "Fotball",
    format,
    scoring: defaultScoringConfig(profile),
    parallelism: parallel ? "parallel" : "sequential",
    config: { playoffSize: format === "league_playoff" ? (body.playoffSize ?? 4) : 0, roundRobinDouble: false },
    teams: Array.from({ length: n }, (_, i) => ({
      name: `Lag ${i + 1}`,
      colour: "#888888",
      logo_url: null,
    })),
    courts: parallel ? Array.from({ length: courtN }, (_, i) => ({ name: `Bane ${i + 1}` })) : [],
  });

  return ok(result);
}
