import { ok, fail, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { createTournament, type CreateInput } from "@/lib/server/build";
import { getOptionalAdmin } from "@/lib/server/auth";
import type { Format, ScoringProfileKey } from "@/lib/types";

// POST /api/tournament — create a tournament from the onboarding wizard (and
// /hurtig). This route is the seam between the wizard and lib/server/build:
// everything the wizard can configure MUST be whitelisted through here, or it
// silently never reaches the database. (That is exactly what happened to the
// group stage + bronze final: the wizard offered them, build.ts supported them,
// and this route dropped them — see test/create-route-config.test.ts.)

const FORMATS: readonly Format[] = ["league", "league_playoff", "cup", "group_playoff"];
const PROFILES: readonly ScoringProfileKey[] = ["simple", "sets", "winner"];
const PLAYOFF_SIZES = new Set([0, 2, 4, 8, 16]);

function intOr(v: unknown, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.floor(n) : dflt;
}

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
  if (!FORMATS.includes(body.format)) return fail(400, "ugyldig_format");
  // scoring is read by build.ts as `s.profile` — an absent/malformed object
  // used to throw and surface as a 500; reject it up front instead.
  if (
    !body.scoring ||
    typeof body.scoring !== "object" ||
    !PROFILES.includes(body.scoring.profile)
  )
    return fail(400, "ugyldig_poeng");
  if (!Array.isArray(body.teams) || body.teams.length < 2)
    return fail(400, "minst_to_lag");
  // Upper bound: 64 teams already implies ~2016 league matches — well past any
  // real classroom event, and a guard against an accidental/DoS huge schedule.
  if (body.teams.length > 64) return fail(400, "for_mange_lag");
  if (body.teams.some((t) => !t?.name?.trim()))
    return fail(400, "lag_mangler_navn");

  // Sanitise structural config so a malformed payload can't build a broken
  // bracket or oversized schedule. Every key the wizard sets is carried through
  // (build.ts clamps the group numbers and drops what a format doesn't use).
  const cfg = body.config ?? {};
  const rawPlayoff = intOr(cfg.playoffSize, 0);
  const playoffSize = (PLAYOFF_SIZES.has(rawPlayoff) ? rawPlayoff : 0) as
    | 0
    | 2
    | 4
    | 8
    | 16;
  const isGroup = body.format === "group_playoff";
  const groupCount = intOr(cfg.groupCount, 2);
  const advancePerGroup = intOr(cfg.advancePerGroup, 2);
  if (isGroup) {
    // Every group needs at least two teams, or its round-robin is empty.
    if (groupCount < 2 || groupCount > 8) return fail(400, "ugyldig_antall_grupper");
    if (groupCount * 2 > body.teams.length) return fail(400, "for_mange_grupper");
    if (advancePerGroup < 1 || advancePerGroup > 4)
      return fail(400, "ugyldig_antall_videre");
  }

  try {
    const result = await createTournament({
      title: (body.title ?? "").trim().slice(0, 80),
      sport_label: (body.sport_label ?? "").trim().slice(0, 40),
      format: body.format,
      scoring: body.scoring,
      parallelism: body.parallelism === "parallel" ? "parallel" : "sequential",
      config: {
        playoffSize,
        roundRobinDouble: !!cfg.roundRobinDouble,
        thirdPlace: !!cfg.thirdPlace,
        ...(isGroup ? { groupCount, advancePerGroup } : {}),
      },
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
