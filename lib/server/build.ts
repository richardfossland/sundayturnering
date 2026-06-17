import "server-only";

import { db, getMatches } from "@/lib/server/store";
import {
  generateControlCode,
  generateWordCode,
} from "@/lib/codes";
import { generateRoundRobin } from "@/lib/tournament/roundRobin";
import { buildBracket } from "@/lib/tournament/bracket";
import { splitIntoGroups } from "@/lib/tournament/groups";
import { defaultScoringConfig } from "@/lib/tournament/scoring";
import type {
  Format,
  Parallelism,
  ScoringConfig,
  TournamentConfig,
  Tournament,
} from "@/lib/types";

export interface CreateInput {
  title: string;
  sport_label: string;
  format: Format;
  scoring: ScoringConfig;
  parallelism: Parallelism;
  config: TournamentConfig;
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
  const board_code = generateWordCode();
  const organiser_code = generateWordCode();

  const scoring = sanitiseScoring(input.scoring);
  const hasPlayoff =
    input.format === "league_playoff" || input.format === "group_playoff";
  const config: TournamentConfig = {
    playoffSize: hasPlayoff ? input.config.playoffSize : 0,
    roundRobinDouble: !!input.config.roundRobinDouble,
    thirdPlace: !!input.config.thirdPlace,
    ...(input.format === "group_playoff"
      ? {
          groupCount: clampInt(input.config.groupCount, 2, 8, 2),
          advancePerGroup: clampInt(input.config.advancePerGroup, 1, 4, 2),
        }
      : {}),
  };
  const status = input.format === "cup" ? "playoff" : "league";

  const { data: trow, error: terr } = await sb
    .from("tournaments")
    .insert({
      control_code,
      board_code,
      organiser_code,
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
    const { data: crows } = await sb
      .from("courts")
      .insert(
        input.courts.map((c, i) => ({
          tournament_id: t.id,
          name: c.name,
          sort_order: i,
        })),
      )
      .select("*");
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
    });
  } else if (input.format === "group_playoff") {
    await buildGroupMatches(t, teamIds, courtIds);
  } else {
    await buildLeagueMatches(t, teamIds, courtIds);
  }

  return { id: t.id, control_code, board_code, organiser_code };
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : dflt;
  return Math.max(lo, Math.min(hi, n));
}

function sanitiseScoring(s: ScoringConfig): ScoringConfig {
  const base = defaultScoringConfig(s.profile);
  return {
    profile: s.profile,
    setsBestOf: s.profile === "sets" ? (s.setsBestOf ?? base.setsBestOf) : undefined,
    pointsWin: numOr(s.pointsWin, 3),
    pointsDraw: numOr(s.pointsDraw, 1),
    pointsLoss: numOr(s.pointsLoss, 0),
    allowDraw: s.profile === "simple" ? !!s.allowDraw : false,
  };
}
function numOr(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
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
  const rows = pairings.map((p) => ({
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
  if (rows.length) await db().from("matches").insert(rows);
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
  await Promise.all(updates);

  // Round-robin within each group; queue_order stays globally monotonic.
  let queue = 0;
  const rows: object[] = [];
  groups.forEach((ids, g) => {
    const pairings = generateRoundRobin(ids, {
      double: t.config.roundRobinDouble,
      courtCount: t.parallelism === "parallel" ? courtIds.length : 0,
    });
    for (const p of pairings) {
      rows.push({
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
      });
    }
  });
  if (rows.length) await sb.from("matches").insert(rows);
}

/** Build a seeded single-elim bracket and persist matches + winner-flow links
 * (plus loser-flow links into the bronze final when `opts.thirdPlace`). */
export async function buildCupMatches(
  tournamentId: string,
  seededTeamIds: string[],
  courtIds: string[],
  opts?: { thirdPlace?: boolean },
): Promise<void> {
  const sb = db();
  const bracket = buildBracket(seededTeamIds, { thirdPlace: opts?.thirdPlace });

  // Insert matches; remember (round,slot) → queue_order so we can map ids back.
  let queue = 0;
  const rows = bracket.matches.map((m) => {
    const courtId =
      courtIds.length > 0 && m.status !== "bye"
        ? courtIds[m.slot % courtIds.length]
        : null;
    return {
      tournament_id: tournamentId,
      phase: "playoff" as const,
      round: m.round,
      bracket_slot: m.slot,
      court_id: courtId,
      queue_order: queue++,
      home_team_id: m.homeId,
      away_team_id: m.awayId,
      status: m.status,
      winner_team_id: m.winnerId,
    };
  });
  await sb.from("matches").insert(rows);

  // Read back to get ids keyed by (round, slot).
  const persisted = await getMatches(tournamentId);
  const idOf = new Map<string, string>();
  for (const m of persisted)
    if (m.phase === "playoff")
      idOf.set(`${m.round}:${m.bracket_slot}`, m.id);

  const links = bracket.links
    .map((l) => {
      const from = idOf.get(`${l.fromRound}:${l.fromSlot}`);
      const to = idOf.get(`${l.toRound}:${l.toSlot}`);
      if (!from || !to) return null;
      return {
        tournament_id: tournamentId,
        from_match_id: from,
        to_match_id: to,
        to_slot: l.toSide,
        feed: l.feed,
      };
    })
    .filter(Boolean);
  if (links.length) await sb.from("bracket_links").insert(links as object[]);
}
