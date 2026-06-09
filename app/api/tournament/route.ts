import { ok, fail, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { createTournament, type CreateInput } from "@/lib/server/build";

// POST /api/tournament — create a tournament from the onboarding wizard.
export async function POST(req: Request) {
  if (!rateLimit(`create:${clientIp(req)}`, 10, 60_000))
    return fail(429, "for_mange_forsok");

  const body = await readJson<CreateInput>(req);
  if (!body) return fail(400, "ugyldig_body");

  // Minimal structural validation; pure logic + DB constraints do the rest.
  if (!["league", "league_playoff", "cup"].includes(body.format))
    return fail(400, "ugyldig_format");
  if (!Array.isArray(body.teams) || body.teams.length < 2)
    return fail(400, "minst_to_lag");
  if (body.teams.some((t) => !t.name?.trim()))
    return fail(400, "lag_mangler_navn");

  try {
    const result = await createTournament({
      title: (body.title ?? "").trim(),
      sport_label: (body.sport_label ?? "").trim(),
      format: body.format,
      scoring: body.scoring,
      parallelism: body.parallelism === "parallel" ? "parallel" : "sequential",
      config: body.config ?? { playoffSize: 0, roundRobinDouble: false },
      teams: body.teams.map((t) => ({
        name: t.name.trim(),
        colour: t.colour || "#888888",
        logo_url: t.logo_url ?? null,
      })),
      courts: Array.isArray(body.courts) ? body.courts : [],
    });
    return ok(result);
  } catch (e) {
    console.error("[create]", e);
    return fail(500, "kunne_ikke_opprette");
  }
}
