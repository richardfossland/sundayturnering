import { ok, fail, readJson, rateLimit, ipKey, withApi } from "@/lib/server/http";
import { createTournament, type CreateInput } from "@/lib/server/build";
import { getOptionalAdmin } from "@/lib/server/auth";
import type { Format, ScoringProfileKey } from "@/lib/types";
import { sanitiseColour, sanitiseLogoUrl } from "@/lib/server/logo";
import { clampPlayoffSize } from "@/lib/tournament/playoffSize";
import { sanitiseSchedule } from "@/lib/tournament/schedule";
import { sanitiseTiebreak } from "@/lib/tournament/standings";
import { sanitiseSwissRounds } from "@/lib/tournament/swiss";
import { sanitiseConsolation } from "@/lib/tournament/consolation";
import { DOUBLE_ELIM_MAX_TEAMS, DOUBLE_ELIM_MIN_TEAMS } from "@/lib/tournament/doubleElim";

// POST /api/tournament — create a tournament from the onboarding wizard (and
// /hurtig). This route is the seam between the wizard and lib/server/build:
// everything the wizard can configure MUST be whitelisted through here, or it
// silently never reaches the database. (That is exactly what happened to the
// group stage + bronze final: the wizard offered them, build.ts supported them,
// and this route dropped them — see test/create-route-config.test.ts.)

const FORMATS: readonly Format[] = ["league", "league_playoff", "cup", "group_playoff", "double_elim", "swiss"];
const PROFILES: readonly ScoringProfileKey[] = ["simple", "sets", "winner"];

function intOr(v: unknown, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.floor(n) : dflt;
}

async function handlePOST(req: Request) {
  if (!rateLimit(`create:${ipKey(req)}`, 10, 60_000))
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
  // Dobbel utslag er bygget for 3–32 lag (L-braketten vokser fort).
  if (body.format === "double_elim") {
    if (body.teams.length < DOUBLE_ELIM_MIN_TEAMS) return fail(400, "for_fa_lag_dobbel");
    if (body.teams.length > DOUBLE_ELIM_MAX_TEAMS) return fail(400, "for_mange_lag_dobbel");
  }
  // Swiss trenger minst tre lag (med to lag er det bare én mulig kamp).
  if (body.format === "swiss" && body.teams.length < 3) return fail(400, "for_fa_lag_swiss");
  if (body.teams.some((t) => typeof t?.name !== "string" || !t.name.trim()))
    return fail(400, "lag_mangler_navn");

  // Sanitise structural config so a malformed payload can't build a broken
  // bracket or oversized schedule. Every key the wizard sets is carried through
  // (build.ts clamps the group numbers and drops what a format doesn't use).
  const cfg = body.config ?? {};
  // Clamp DOWN to the largest bracket that fits (3 teams asking for 4 → 2);
  // this used to silently become 0 = a "Liga + sluttspill" with no playoff.
  const playoffSize = clampPlayoffSize(cfg.playoffSize, body.teams.length);
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

  // Swiss: antall runder 1..N−1 (uten verdi: ceil(log2 N)).
  const swissRounds = sanitiseSwissRounds(cfg.swiss?.rounds, body.teams.length);
  if (body.format === "swiss" && swissRounds === "invalid") return fail(400, "ugyldig_antall_runder");

  // Tidsplan er valgfri; er den sendt må den være gyldig.
  const schedule = sanitiseSchedule(cfg.schedule);
  if (schedule === "invalid") return fail(400, "ugyldig_tidsplan");

  // Rekkefølge ved likt er valgfri; ukjente nøkler/forhåndsvalg avvises.
  const tiebreak = sanitiseTiebreak(cfg.tiebreak);
  if (tiebreak === "invalid") return fail(400, "ugyldig_tiebreak");

  // Ekstra sluttspill er valgfritt; ukjent verdi eller et valg som ikke passer
  // formatet avvises. (For få lag til å bygge det blir stille «ingen» i build.ts.)
  const consolation = sanitiseConsolation(cfg.consolation, body.format);
  if (consolation === "invalid") return fail(400, "ugyldig_ekstra_sluttspill");

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
        ...(schedule ? { schedule } : {}),
        ...(tiebreak ? { tiebreak } : {}),
        ...(consolation ? { consolation } : {}),
        ...(body.format === "swiss" && swissRounds !== "invalid" ? { swiss: { rounds: swissRounds } } : {}),
        ...(body.format === "double_elim"
          ? { doubleElim: { grandFinalReset: cfg.doubleElim?.grandFinalReset !== false } }
          : {}),
      },
      organiserId: admin?.id ?? null,
      teams: body.teams.map((t) => ({
        name: t.name.trim().slice(0, 60),
        colour: sanitiseColour(t.colour),
        logo_url: sanitiseLogoUrl(t.logo_url),
        members: Array.isArray(t.members)
          ? t.members.map((m) => String(m).trim()).filter(Boolean).slice(0, 40)
          : [],
      })),
      courts: (Array.isArray(body.courts) ? body.courts : [])
        .slice(0, 32)
        .map((c, i) => ({
          name:
            (typeof c?.name === "string" ? c.name.trim().slice(0, 40) : "") ||
            `Bane ${i + 1}`,
        })),
    });
    return ok(result);
  } catch (e) {
    console.error("[create]", e);
    return fail(500, "kunne_ikke_opprette");
  }
}

export const POST = withApi(handlePOST);
