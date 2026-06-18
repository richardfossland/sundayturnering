import { ok, fail, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { createTournament, type CreateInput } from "@/lib/server/build";
import { getOptionalAdmin } from "@/lib/server/auth";

// POST /api/tournament — create a tournament from the onboarding wizard.
export async function POST(req: Request) {
  if (!rateLimit(`create:${clientIp(req)}`, 10, 60_000))
    return fail(429, "for_mange_forsok");

  const body = await readJson<CreateInput>(req);
  if (!body) return fail(400, "ugyldig_body");

  // If a Sunday Account admin is signed in, stamp ownership so the tournament
  // shows up in /admin. Anonymous /hurtig + /ny creates resolve to null here
  // and keep working with zero auth.
  const admin = await getOptionalAdmin();

  // Minimal structural validation; pure logic + DB constraints do the rest.
  if (!["league", "league_playoff", "cup"].includes(body.format))
    return fail(400, "ugyldig_format");
  if (!Array.isArray(body.teams) || body.teams.length < 2)
    return fail(400, "minst_to_lag");
  // Upper bound: 64 teams already implies ~2016 league matches — well past any
  // real classroom event, and a guard against an accidental/DoS huge schedule.
  if (body.teams.length > 64) return fail(400, "for_mange_lag");
  if (body.teams.some((t) => !t.name?.trim()))
    return fail(400, "lag_mangler_navn");

  // Sanitise structural config so a malformed payload can't build a broken
  // bracket or oversized schedule.
  const allowedPlayoff = new Set([0, 2, 4, 8, 16]);
  const rawPlayoff = Number(body.config?.playoffSize);
  const playoffSize = (allowedPlayoff.has(rawPlayoff) ? rawPlayoff : 0) as
    | 0
    | 2
    | 4
    | 8
    | 16;

  try {
    const result = await createTournament({
      title: (body.title ?? "").trim().slice(0, 80),
      sport_label: (body.sport_label ?? "").trim().slice(0, 40),
      format: body.format,
      scoring: body.scoring,
      parallelism: body.parallelism === "parallel" ? "parallel" : "sequential",
      config: { playoffSize, roundRobinDouble: !!body.config?.roundRobinDouble },
      organiserId: admin?.id ?? null,
      teams: body.teams.map((t) => ({
        name: t.name.trim().slice(0, 60),
        colour: t.colour || "#888888",
        logo_url: t.logo_url ?? null,
        members: Array.isArray(t.members)
          ? t.members.map((m) => String(m).trim()).filter(Boolean).slice(0, 40)
          : [],
      })),
      courts: (Array.isArray(body.courts) ? body.courts : []).slice(0, 32),
    });
    return ok(result);
  } catch (e) {
    console.error("[create]", e);
    return fail(500, "kunne_ikke_opprette");
  }
}
