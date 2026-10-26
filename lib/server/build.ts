import "server-only";

import { db, getMatches } from "@/lib/server/store";
import {
  generateControlCode,
  generateWordCode,
} from "@/lib/codes";
import { generateRoundRobin } from "@/lib/tournament/roundRobin";
import {
  buildCupConsolationSet,
  buildPlayoffSet,
  cupConsolationFeasible,
  type BracketSet,
} from "@/lib/tournament/consolation";
import { buildDoubleElim, doubleElimOrder } from "@/lib/tournament/doubleElim";
import { splitIntoGroups } from "@/lib/tournament/groups";
import { defaultScoringConfig } from "@/lib/tournament/scoring";
import { sanitiseTiebreak } from "@/lib/tournament/standings";
import { defaultSwissRounds, sanitiseSwissRounds } from "@/lib/tournament/swiss";
import { insertSwissRound } from "@/lib/server/swiss";
import { planSlots, sanitiseSchedule, type SlotLink } from "@/lib/tournament/schedule";
import type {
  Format,
  Parallelism,
  ScheduleConfig,
  ScoringConfig,
  TournamentConfig,
  Tournament,
} from "@/lib/types";
import type { Consolation } from "@/lib/types";

export interface CreateInput {
  title: string;
  sport_label: string;
  format: Format;
  scoring: ScoringConfig;
  parallelism: Parallelism;
  config: TournamentConfig;
  /** Sunday Account owner. Set server-side when an admin is signed in; null for
   * anonymous /hurtig + /ny creates (which must keep working). */
  organiserId?: string | null;
  teams: {
    name: string;
    colour: string;
    logo_url?: string | null;
    members?: string[];
  }[];
  courts: { name: string }[];
}

export interface CreateResult {
  id: string;
  control_code: string;
  board_code: string;
  organiser_code: string;
}

/** Every write in a build must land, or the caller's rollback (delete the
 * tournament / revert the playoff claim) has to run. supabase-js reports a
 * failed insert in `error` instead of throwing — ignoring it used to leave a
 * "created" tournament with no schedule, or a playoff with no bracket. */
function must(res: { error: { message: string } | null }, what: string): void {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}

/** Create a tournament: insert the row + teams + courts, then build and persist
 * the initial schedule (league round-robin, or a cup bracket). */
export async function createTournament(
  input: CreateInput,
): Promise<CreateResult> {
  const sb = db();

  // --- unique control code (DB-enforced); retry a few times on clash ---
  let control_code = generateControlCode();
  for (let i = 0; i < 8; i++) {
    const { data } = await sb
      .from("tournaments")
      .select("id")
      .eq("control_code", control_code)
      .maybeSingle();
    if (!data) break;
    control_code = generateControlCode();
  }
  // board_code has no DB unique constraint (and a clash made /tavle resolve to
  // neither tournament), so check it here the same way.
  let board_code = generateWordCode();
  for (let i = 0; i < 8; i++) {
    const { data } = await sb
      .from("tournaments")
      .select("id")
      .eq("board_code", board_code)
      .limit(1);
    if (!data?.length) break;
    board_code = generateWordCode();
  }
  const organiser_code = generateWordCode();

  const scoring = sanitiseScoring(input.scoring);
  const hasPlayoff =
    input.format === "league_playoff" || input.format === "group_playoff";
  // Ugyldig antall runder avvises av ruta; her faller det bare tilbake til standard.
  const rawRounds = sanitiseSwissRounds(input.config.swiss?.rounds, input.teams.length);
  const swissRounds = rawRounds === "invalid" ? defaultSwissRounds(input.teams.length) : rawRounds;
  const config: TournamentConfig = {
    playoffSize: hasPlayoff ? input.config.playoffSize : 0,
    roundRobinDouble: !!input.config.roundRobinDouble,
    thirdPlace: input.format === "double_elim" ? false : !!input.config.thirdPlace,
    ...(input.format === "double_elim"
      ? { doubleElim: { grandFinalReset: input.config.doubleElim?.grandFinalReset !== false } }
      : {}),
    ...(input.format === "swiss" ? { swiss: { rounds: swissRounds } } : {}),
    ...(input.format === "group_playoff"
      ? {
          groupCount: clampInt(input.config.groupCount, 2, 8, 2),
          advancePerGroup: clampInt(input.config.advancePerGroup, 1, 4, 2),
        }
      : {}),
  };
  // Tidsplan er valgfri; ugyldig oppsett ignoreres (ruta avviser det først).
  const schedule = sanitiseSchedule(input.config.schedule);
  if (schedule && schedule !== "invalid") config.schedule = schedule;
  const tiebreak = sanitiseTiebreak(input.config.tiebreak);
  if (tiebreak && tiebreak !== "invalid" && input.format !== "cup" && input.format !== "double_elim") config.tiebreak = tiebreak;
  // Swiss uten eget valg rangeres Buchholz → Sonneborn-Berger (ikke «standard»).
  if (input.format === "swiss" && !config.tiebreak) config.tiebreak = "swiss";
  const consolation = validConsolation(input);
  if (consolation !== "none") config.consolation = consolation;
  const status = input.format === "cup" || input.format === "double_elim" ? "playoff" : "league";

  const { data: trow, error: terr } = await sb
    .from("tournaments")
    .insert({
      control_code,
      board_code,
      organiser_code,
      organiser_id: input.organiserId ?? null,
      title: input.title,
      sport_label: input.sport_label,
      format: input.format,
      scoring,
      parallelism: input.parallelism,
      config,
      status,
    })
    .select("*")
    .single();
  if (terr || !trow) throw new Error(terr?.message ?? "insert tournament failed");
  const t = trow as Tournament;

  try {
    return await buildRest(sb, t, input, control_code, board_code, organiser_code);
  } catch (e) {
    // A later insert failed → don't leave a half-built tournament. Deleting the
    // row cascades to courts/teams/matches/bracket_links.
    await sb.from("tournaments").delete().eq("id", t.id);
    throw e;
  }
}

/** Ekstra sluttspill som faktisk lar seg bygge: færre enn to lag i B (eller en
 * trøsterunde uten nok førsterundetapere) blir stille til «ingen», som
 * `clampPlayoffSize` gjør for sluttspillstørrelsen. */
function validConsolation(input: CreateInput): Consolation {
  const c = input.config.consolation;
  const n = input.teams.length;
  if (input.format === "cup")
    return c === "first_round_losers" && cupConsolationFeasible(n) ? c : "none";
  if (input.format === "league_playoff")
    return c === "b_playoff" && n - (input.config.playoffSize ?? 0) >= 2 ? c : "none";
  if (input.format === "group_playoff") {
    const groups = clampInt(input.config.groupCount, 2, 8, 2);
    const adv = clampInt(input.config.advancePerGroup, 1, 4, 2);
    return c === "b_playoff" && n - groups * adv >= 2 ? c : "none";
  }
  return "none";
}

async function buildRest(
  sb: ReturnType<typeof db>,
  t: Tournament,
  input: CreateInput,
  control_code: string,
  board_code: string,
  organiser_code: string,
): Promise<CreateResult> {
  // --- courts (parallel only) ---
  let courtIds: string[] = [];
  if (input.parallelism === "parallel" && input.courts.length > 0) {
    const { data: crows, error: courtErr } = await sb
      .from("courts")
      .insert(
        input.courts.map((c, i) => ({
          tournament_id: t.id,
          name: c.name,
          sort_order: i,
        })),
      )
      .select("*");
    must({ error: courtErr }, "insert courts");
    courtIds = (crows ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => c.id as string);
  }

  // --- teams (seed = entry order, used directly by cup; playoff overrides) ---
  const { data: teamRows, error: teamErr } = await sb
    .from("teams")
    .insert(
      input.teams.map((tm, i) => ({
        tournament_id: t.id,
        name: tm.name,
        colour: tm.colour,
        logo_url: tm.logo_url ?? null,
        members: Array.isArray(tm.members) ? tm.members : [],
        seed: i + 1,
        sort_order: i,
      })),
    )
    .select("*");
  if (teamErr || !teamRows) throw new Error(teamErr?.message ?? "insert teams failed");
  const teamIds = [...teamRows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => r.id as string);

  // --- schedule ---
  if (input.format === "cup") {
    await buildCupMatches(t.id, teamIds, courtIds, {
      thirdPlace: t.config.thirdPlace,
      schedule: t.config.schedule,
      consolation: t.config.consolation,
    });
  } else if (input.format === "double_elim") {
    await buildDoubleElimMatches(t.id, teamIds, courtIds, {
      schedule: t.config.schedule,
      grandFinalReset: t.config.doubleElim?.grandFinalReset !== false,
    });
  } else if (input.format === "swiss") {
    await insertSwissRound(t, 1); // bare runde 1; resten legges via organiser/advance
  } else if (input.format === "group_playoff") {
    await buildGroupMatches(t, teamIds, courtIds);
  } else {
    await buildLeagueMatches(t, teamIds, courtIds);
  }

  return { id: t.id, control_code, board_code, organiser_code };
}

/** Sett `scheduled_at` på radene (ingen tidsplan ⇒ null, som før). `key` gir
 * hver rad en stabil nøkkel; `links` er brakettkoblinger over de samme nøklene.
 * Rader uten låst bane får banen planleggeren velger (tidligste ledige). */
function withSchedule<R extends {
  court_id: string | null;
  queue_order: number;
  home_team_id: string | null;
  away_team_id: string | null;
  status: string;
}>(
  rows: R[],
  key: (r: R, i: number) => string,
  courtIds: string[],
  cfg: ScheduleConfig | undefined,
  links: SlotLink[] = [],
  notBefore?: Date,
): (R & { scheduled_at: string | null })[] {
  const slots = cfg
    ? planSlots(
        rows.map((r, i) => ({ ...r, id: key(r, i), status: r.status as "scheduled" })),
        courtIds,
        cfg,
        { links, notBefore },
      )
    : new Map<string, { at: string; courtId: string | null }>();
  return rows.map((r, i) => {
    const p = slots.get(key(r, i));
    return { ...r, court_id: r.court_id ?? p?.courtId ?? null, scheduled_at: p?.at ?? null };
  });
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : dflt;
  return Math.max(lo, Math.min(hi, n));
}

function sanitiseScoring(s: ScoringConfig): ScoringConfig {
  const base = defaultScoringConfig(s.profile);
  return {
    profile: s.profile,
    setsBestOf:
      s.profile === "sets"
        ? [3, 5, 7].includes(s.setsBestOf as number)
          ? s.setsBestOf
          : base.setsBestOf
        : undefined,
    pointsWin: clampInt(s.pointsWin, 0, 100, 3),
    pointsDraw: clampInt(s.pointsDraw, 0, 100, 1),
    pointsLoss: clampInt(s.pointsLoss, 0, 100, 0),
    allowDraw: s.profile === "simple" ? !!s.allowDraw : false,
  };
}

async function buildLeagueMatches(
  t: Tournament,
  teamIds: string[],
  courtIds: string[],
): Promise<void> {
  const pairings = generateRoundRobin(teamIds, {
    double: t.config.roundRobinDouble,
    courtCount: t.parallelism === "parallel" ? courtIds.length : 0,
  });
  const plain = pairings.map((p) => ({
    tournament_id: t.id,
    phase: "league" as const,
    round: p.round,
    bracket_slot: null,
    court_id:
      p.courtIndex !== null && courtIds[p.courtIndex]
        ? courtIds[p.courtIndex]
        : null,
    queue_order: p.queueOrder,
    home_team_id: p.homeId,
    away_team_id: p.awayId,
    status: (p.awayId === null ? "bye" : "scheduled") as "bye" | "scheduled",
    winner_team_id: p.awayId === null ? p.homeId : null,
  }));
  const rows = withSchedule(plain, (_, i) => String(i), courtIds, t.config.schedule);
  if (rows.length) must(await db().from("matches").insert(rows), "insert league matches");
}

/** Build the group stage: split seeded teams into balanced groups, persist each
 * team's group_no, then a round-robin WITHIN each group (phase 'league'). The
 * knockout bracket is built later, at advance time, from the group standings. */
async function buildGroupMatches(
  t: Tournament,
  teamIds: string[],
  courtIds: string[],
): Promise<void> {
  const sb = db();
  const groupCount = t.config.groupCount ?? 2;
  const groups = splitIntoGroups(teamIds, groupCount);

  // Persist group membership on each team.
  const updates: PromiseLike<unknown>[] = [];
  groups.forEach((ids, g) => {
    for (const id of ids)
      updates.push(sb.from("teams").update({ group_no: g }).eq("id", id));
  });
  for (const res of (await Promise.all(updates)) as { error: { message: string } | null }[])
    must(res, "set group");

  // Round-robin within each group; queue_order stays globally monotonic.
  let queue = 0;
  const plain: {
    court_id: string | null;
    queue_order: number;
    home_team_id: string | null;
    away_team_id: string | null;
    status: "bye" | "scheduled";
  }[] = [];
  groups.forEach((ids, g) => {
    const pairings = generateRoundRobin(ids, {
      double: t.config.roundRobinDouble,
      courtCount: t.parallelism === "parallel" ? courtIds.length : 0,
    });
    for (const p of pairings) {
      plain.push({
        tournament_id: t.id,
        phase: "league" as const,
        round: p.round,
        group_no: g,
        bracket_slot: null,
        court_id:
          p.courtIndex !== null && courtIds[p.courtIndex]
            ? courtIds[p.courtIndex]
            : null,
        queue_order: queue++,
        home_team_id: p.homeId,
        away_team_id: p.awayId,
        status: p.awayId === null ? "bye" : "scheduled",
        winner_team_id: p.awayId === null ? p.homeId : null,
      } as (typeof plain)[number]);
    }
  });
  const rows = withSchedule(plain, (_, i) => String(i), courtIds, t.config.schedule);
  if (rows.length) must(await sb.from("matches").insert(rows), "insert group matches");
}

/** Build a seeded single-elim bracket (plus an optional B bracket) and persist
 * matches + winner-flow links (and loser-flow links into the bronze final or, for
 * a cup consolation, from the first round into B). All brackets are scheduled in
 * ONE pass so they share the courts. `bSeeds` = B-sluttspill for the rest after a
 * league/group stage; `consolation: "first_round_losers"` = cup trøsterunde. */
export async function buildCupMatches(
  tournamentId: string,
  seededTeamIds: string[],
  courtIds: string[],
  opts?: {
    thirdPlace?: boolean;
    schedule?: ScheduleConfig;
    notBefore?: Date;
    consolation?: Consolation;
    bSeeds?: string[];
  },
): Promise<void> {
  const set: BracketSet =
    opts?.consolation === "first_round_losers"
      ? buildCupConsolationSet(seededTeamIds, { thirdPlace: opts.thirdPlace })
      : buildPlayoffSet(seededTeamIds, { thirdPlace: opts?.thirdPlace, bSeeds: opts?.bSeeds });
  await persistBracketSet(tournamentId, set, courtIds, opts);
}

/** Dobbel utslag: vinnerbrakett (W), taperbrakett (L) og storfinale (GF) lagres
 * som vanlige sluttspillkamper + koblinger, og tidsplanlegges i ett pass så de
 * deler banene (L-runder kommer etter W-rundene som mater dem). */
export async function buildDoubleElimMatches(
  tournamentId: string,
  seededTeamIds: string[],
  courtIds: string[],
  opts?: { schedule?: ScheduleConfig; grandFinalReset?: boolean },
): Promise<void> {
  const set = buildDoubleElim(seededTeamIds, { grandFinalReset: opts?.grandFinalReset });
  await persistBracketSet(tournamentId, set, courtIds, {
    schedule: opts?.schedule,
    order: doubleElimOrder,
  });
}

/** Lagre et brakettsett: kamper (med tidsplan), så koblinger med riktige id-er. */
async function persistBracketSet(
  tournamentId: string,
  set: BracketSet,
  courtIds: string[],
  opts?: {
    schedule?: ScheduleConfig;
    notBefore?: Date;
    /** Spillerekkefølge (lavest først); default runde for runde, brakett for brakett. */
    order?: (bracket: string, round: number) => number;
  },
): Promise<void> {
  const sb = db();

  // Spillerekkefølge: runde for runde, A før B, så B-runde 1 kommer rett etter
  // A-runde 1 (og ikke etter hele A). Med bare A er dette samme rekkefølge som før.
  const flat = set.brackets.flatMap(({ id, bracket }, bi) =>
    bracket.matches.map((m) => ({ id, bi, m })),
  );
  const at = (id: string, round: number) => opts?.order?.(id, round) ?? round;
  flat.sort((x, y) => at(x.id, x.m.round) - at(y.id, y.m.round) || x.bi - y.bi || x.m.slot - y.m.slot);

  let queue = 0;
  const perRound = new Map<number, number>();
  const plain = flat.map(({ id, m }) => {
    // Bane settes av tidsplanen (tidligste ledige). Uten tidsplan fordeles
    // kampene jevnt over banene innen hver runde, i spillerekkefølge.
    let courtId: string | null = null;
    if (!opts?.schedule && courtIds.length > 0 && m.status !== "bye") {
      const o = at(id, m.round);
      const n = perRound.get(o) ?? 0;
      perRound.set(o, n + 1);
      courtId = courtIds[n % courtIds.length];
    }
    return {
      tournament_id: tournamentId,
      phase: "playoff" as const,
      round: m.round,
      bracket_slot: m.slot,
      // 'A' er kolonnens default; utelatt så insert virker også før migrasjon 0016.
      ...(id === "A" ? {} : { bracket: id }),
      court_id: courtId,
      queue_order: queue++,
      home_team_id: m.homeId,
      away_team_id: m.awayId,
      status: m.status,
      winner_team_id: m.winnerId,
    };
  });
  // Nøkkel (brakett:runde:slot) så tidsplanen kan kjøres før insert, på tvers av braketter.
  const key = (b: string, r: number, s: number) => `${b}:${r}:${s}`;
  const rowKey = (r: { bracket?: string; round: number; bracket_slot: number }) =>
    key(r.bracket ?? "A", r.round, r.bracket_slot);
  const slotLinks = [
    ...set.brackets.flatMap(({ id, bracket }) =>
      bracket.links.map((l) => ({
        from_match_id: key(id, l.fromRound, l.fromSlot),
        to_match_id: key(id, l.toRound, l.toSlot),
      })),
    ),
    ...set.cross.map((c) => ({
      from_match_id: key(c.fromBracket, c.fromRound, c.fromSlot),
      to_match_id: key(c.toBracket, c.toRound, c.toSlot),
    })),
  ];
  const rows = withSchedule(plain, rowKey, courtIds, opts?.schedule, slotLinks, opts?.notBefore);
  must(await sb.from("matches").insert(rows), "insert bracket matches");

  // Read back to get ids keyed by (bracket, round, slot).
  const persisted = await getMatches(tournamentId);
  const idOf = new Map<string, string>();
  for (const m of persisted)
    if (m.phase === "playoff")
      idOf.set(key(m.bracket ?? "A", m.round, m.bracket_slot as number), m.id);

  const links = [
    ...set.brackets.flatMap(({ id, bracket }) =>
      bracket.links.map((l) => ({
        from: key(id, l.fromRound, l.fromSlot),
        to: key(id, l.toRound, l.toSlot),
        side: l.toSide,
        feed: l.feed,
      })),
    ),
    ...set.cross.map((c) => ({
      from: key(c.fromBracket, c.fromRound, c.fromSlot),
      to: key(c.toBracket, c.toRound, c.toSlot),
      side: c.toSide,
      feed: c.feed,
    })),
  ]
    .map((l) => {
      const from = idOf.get(l.from);
      const to = idOf.get(l.to);
      if (!from || !to) return null;
      return {
        tournament_id: tournamentId,
        from_match_id: from,
        to_match_id: to,
        to_slot: l.side,
        feed: l.feed,
      };
    })
    .filter(Boolean);
  if (links.length)
    must(await sb.from("bracket_links").insert(links as object[]), "insert bracket links");
}
