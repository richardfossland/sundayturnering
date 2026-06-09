import "server-only";

import { db, getMatches } from "@/lib/server/store";
import {
  generateControlCode,
  generateWordCode,
} from "@/lib/codes";
import { generateRoundRobin } from "@/lib/tournament/roundRobin";
import { buildBracket } from "@/lib/tournament/bracket";
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
  teams: { name: string; colour: string; logo_url?: string | null }[];
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
  const config: TournamentConfig = {
    playoffSize:
      input.format === "league_playoff" ? input.config.playoffSize : 0,
    roundRobinDouble: !!input.config.roundRobinDouble,
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
    await buildCupMatches(t.id, teamIds, courtIds);
  } else {
    await buildLeagueMatches(t, teamIds, courtIds);
  }

  return { id: t.id, control_code, board_code, organiser_code };
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

/** Build a seeded single-elim bracket and persist matches + winner-flow links. */
export async function buildCupMatches(
  tournamentId: string,
  seededTeamIds: string[],
  courtIds: string[],
): Promise<void> {
  const sb = db();
  const bracket = buildBracket(seededTeamIds);

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
      };
    })
    .filter(Boolean);
  if (links.length) await sb.from("bracket_links").insert(links as object[]);
}
