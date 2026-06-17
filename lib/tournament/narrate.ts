// Live commentator / announcer auto-feed (spec: "storskjerm-speaker").
//
// PURE module. Diffs two tournament snapshots (before → after) — the same
// StateDTO already flowing through the board via lib/client/useTournament — and
// derives a ranked list of "storylines": short Norwegian narration beats fit
// for a board ticker + full-screen cut-in cards.
//
// No network, no API key, no AI service. The narration is *derived from state
// transitions* that are already authoritative (results, standings, status), so
// it can never disagree with the result path and can never block it. The
// optional read-aloud is browser-native Web Speech (handled in the overlay
// component, also keyless).
//
// LLM seam: this repo has none, and this feature intentionally does not need
// one — the spec calls for a keyless heuristic. If a future "spice up the copy
// with AI" pass is added, it MUST sit behind a server route, validate output
// against the Storyline schema below, and fall back to these heuristic
// storylines verbatim when no key is configured (degrade gracefully). The pure
// diff here is the source of truth and the place all the test coverage lives.

import type { StateDTO } from "@/lib/dto";
import type { Match, StandingRow, Team } from "@/lib/types";
import { resolve } from "@/lib/tournament/scoring";
import { narr } from "@/lib/locale/no";

/** What a storyline is about — drives icon + styling in the overlay. */
export type StorylineKind =
  | "result" // a match result was entered
  | "upset" // lower seed beat a higher seed
  | "rout" // a lopsided win
  | "draw" // a drawn match
  | "live" // a match just kicked off
  | "lead_change" // new team at the top of the table
  | "clinch" // a team secured a playoff spot
  | "playoff" // the playoff/cup bracket started
  | "final" // the final is now live
  | "champion"; // the tournament was won

/** Presentation surface a storyline is suited for. */
export type StorylineDisplay = "ticker" | "cutin";

/**
 * One narration beat. PURE data — the overlay decides how/when to show it.
 * `key` is stable for the underlying event so a queue can de-duplicate across
 * repeated diffs (e.g. a result that re-appears in a later snapshot pair).
 */
export interface Storyline {
  key: string;
  kind: StorylineKind;
  /** 0–100; higher cuts in first / interrupts the ticker. */
  priority: number;
  /** Headline line (short, board-sized). */
  headline: string;
  /** Optional supporting line (e.g. the score, the standing). */
  detail?: string;
  /** Whether this deserves a full-screen cut-in or just the ticker. */
  display: StorylineDisplay;
  /** Team this beat centres on, for colour/emblem in the overlay. */
  teamId?: string;
}

const PRIORITY: Record<StorylineKind, number> = {
  champion: 100,
  final: 90,
  playoff: 80,
  upset: 70,
  clinch: 60,
  lead_change: 55,
  rout: 45,
  draw: 30,
  result: 25,
  live: 15,
};

/** Margin (score diff) at/above which a simple-profile win is a "rout". */
const ROUT_MARGIN = 5;

function teamName(teams: Map<string, Team>, id: string | null): string {
  if (!id) return narr.unknownTeam;
  return teams.get(id)?.name ?? narr.unknownTeam;
}

function indexById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Diff two snapshots into ranked storylines (highest priority first, then by
 * kind weight, with a stable key tiebreak so the order is deterministic).
 *
 * `before` may be null for the very first snapshot — in that case only
 * standing-independent "state of the world" beats are emitted (e.g. an already
 * finished tournament), never a flood of phantom "new result" cards.
 */
export function diffSnapshots(
  before: StateDTO | null,
  after: StateDTO,
): Storyline[] {
  const teams = indexById(after.teams);
  const out: Storyline[] = [];

  if (before) {
    out.push(...resultStorylines(before, after, teams));
    out.push(...liveStorylines(before, after, teams));
    out.push(...standingStorylines(before, after, teams));
    out.push(...statusStorylines(before, after, teams));
  } else {
    // First load: only announce a tournament that is *already* decided, so a
    // board opened mid-event doesn't replay the whole history at once.
    out.push(...statusStorylines(null, after, teams));
  }

  return rank(out);
}

/** Deterministic ordering: priority desc, then key asc. */
export function rank(lines: Storyline[]): Storyline[] {
  return [...lines].sort(
    (a, b) => b.priority - a.priority || a.key.localeCompare(b.key, "no"),
  );
}

// ---------- result transitions ----------

function resultStorylines(
  before: StateDTO,
  after: StateDTO,
  teams: Map<string, Team>,
): Storyline[] {
  const prev = indexById(before.matches);
  const profile = after.tournament.scoring.profile;
  const seed = (id: string | null) =>
    (id && teams.get(id)?.seed) || Number.MAX_SAFE_INTEGER;
  const out: Storyline[] = [];

  for (const m of after.matches) {
    const old = prev.get(m.id);
    // A *newly* completed match with a result. result_version guards re-edits:
    // a corrected score (status already done) bumps it and re-narrates.
    const becameDone =
      m.status === "done" &&
      m.result != null &&
      m.away_team_id != null &&
      (!old ||
        old.status !== "done" ||
        old.result_version !== m.result_version);
    if (!becameDone) continue;

    const r = resolve(profile, m.result!);
    const homeName = teamName(teams, m.home_team_id);
    const awayName = teamName(teams, m.away_team_id);
    const key = `result:${m.id}:${m.result_version}`;

    if (r.winner === "draw") {
      out.push({
        key,
        kind: "draw",
        priority: PRIORITY.draw,
        headline: narr.drawHeadline(homeName, awayName),
        detail: r.display,
        display: "ticker",
      });
      continue;
    }

    const winnerId = r.winner === "home" ? m.home_team_id : m.away_team_id;
    const loserId = r.winner === "home" ? m.away_team_id : m.home_team_id;
    const winnerName = teamName(teams, winnerId);
    const loserName = teamName(teams, loserId);

    // Upset: the winner is seeded clearly below the loser. Seeds are
    // "1 = best", so a larger seed number is the underdog.
    const wSeed = seed(winnerId);
    const lSeed = seed(loserId);
    const isUpset =
      wSeed !== Number.MAX_SAFE_INTEGER &&
      lSeed !== Number.MAX_SAFE_INTEGER &&
      wSeed - lSeed >= 2;

    const margin = Math.abs(r.homeScore - r.awayScore);
    const isRout = profile === "simple" && margin >= ROUT_MARGIN;

    if (isUpset) {
      out.push({
        key,
        kind: "upset",
        priority: PRIORITY.upset,
        headline: narr.upsetHeadline(winnerName, loserName),
        detail: r.display,
        display: "cutin",
        teamId: winnerId ?? undefined,
      });
    } else if (isRout) {
      out.push({
        key,
        kind: "rout",
        priority: PRIORITY.rout,
        headline: narr.routHeadline(winnerName, loserName, margin),
        detail: r.display,
        display: "cutin",
        teamId: winnerId ?? undefined,
      });
    } else {
      out.push({
        key,
        kind: "result",
        priority: PRIORITY.result,
        headline: narr.resultHeadline(winnerName, loserName),
        detail: r.display,
        display: "ticker",
        teamId: winnerId ?? undefined,
      });
    }
  }

  return out;
}

// ---------- kickoff transitions ----------

function liveStorylines(
  before: StateDTO,
  after: StateDTO,
  teams: Map<string, Team>,
): Storyline[] {
  const prev = indexById(before.matches);
  const out: Storyline[] = [];
  for (const m of after.matches) {
    const old = prev.get(m.id);
    const becameLive =
      m.status === "live" && (!old || old.status !== "live");
    if (!becameLive || !m.home_team_id || !m.away_team_id) continue;
    out.push({
      key: `live:${m.id}`,
      kind: "live",
      priority: PRIORITY.live,
      headline: narr.liveHeadline(
        teamName(teams, m.home_team_id),
        teamName(teams, m.away_team_id),
      ),
      display: "ticker",
    });
  }
  return out;
}

// ---------- standings transitions ----------

function standingStorylines(
  before: StateDTO,
  after: StateDTO,
  teams: Map<string, Team>,
): Storyline[] {
  const out: Storyline[] = [];
  const prevTop = topTeam(before.standings);
  const nowTop = topTeam(after.standings);

  // Lead change at the summit of the league table (only once any match has
  // been played, and only when the leader actually changed).
  if (
    nowTop &&
    nowTop.played > 0 &&
    (!prevTop || prevTop.team_id !== nowTop.team_id)
  ) {
    out.push({
      key: `lead:${nowTop.team_id}`,
      kind: "lead_change",
      priority: PRIORITY.lead_change,
      headline: narr.leadHeadline(teamName(teams, nowTop.team_id)),
      detail: narr.leadDetail(nowTop.points),
      display: "cutin",
      teamId: nowTop.team_id,
    });
  }

  // Newly clinched playoff spots (crossed the cut line this update).
  const prevById = indexById2(before.standings);
  for (const row of after.standings) {
    if (!row.inPlayoff) continue;
    const old = prevById.get(row.team_id);
    if (old?.inPlayoff) continue; // already in
    out.push({
      key: `clinch:${row.team_id}`,
      kind: "clinch",
      priority: PRIORITY.clinch,
      headline: narr.clinchHeadline(teamName(teams, row.team_id)),
      display: "ticker",
      teamId: row.team_id,
    });
  }

  return out;
}

function topTeam(standings: StandingRow[]): StandingRow | null {
  // computeStandings already returns rank-sorted rows; rank 1 is the leader.
  return standings.find((s) => s.rank === 1) ?? standings[0] ?? null;
}

function indexById2(rows: StandingRow[]): Map<string, StandingRow> {
  return new Map(rows.map((r) => [r.team_id, r]));
}

// ---------- status / phase transitions ----------

function statusStorylines(
  before: StateDTO | null,
  after: StateDTO,
  teams: Map<string, Team>,
): Storyline[] {
  const out: Storyline[] = [];
  const prevStatus = before?.tournament.status ?? null;
  const status = after.tournament.status;

  // Playoff bracket started.
  if (status === "playoff" && prevStatus !== "playoff" && prevStatus !== "finished") {
    out.push({
      key: "phase:playoff",
      kind: "playoff",
      priority: PRIORITY.playoff,
      headline: narr.playoffHeadline,
      detail: narr.playoffDetail,
      display: "cutin",
    });
  }

  // The final just kicked off (only meaningful in a bracket).
  if (before) {
    const fin = finalKickoff(before, after);
    if (fin) {
      out.push({
        key: "phase:final",
        kind: "final",
        priority: PRIORITY.final,
        headline: narr.finalHeadline(
          teamName(teams, fin.home_team_id),
          teamName(teams, fin.away_team_id),
        ),
        display: "cutin",
      });
    }
  }

  // Tournament finished → champion crowned.
  if (status === "finished" && prevStatus !== "finished") {
    const champId = championId(after);
    if (champId) {
      out.push({
        key: `phase:champion:${champId}`,
        kind: "champion",
        priority: PRIORITY.champion,
        headline: narr.championHeadline(teamName(teams, champId)),
        detail: narr.championDetail,
        display: "cutin",
        teamId: champId,
      });
    }
  }

  return out;
}

/** The playoff final match if it transitioned to live in this diff. */
function finalKickoff(before: StateDTO, after: StateDTO): Match | null {
  const playoff = after.matches.filter((m) => m.phase === "playoff");
  if (playoff.length === 0) return null;
  const finalRound = Math.max(...playoff.map((m) => m.round));
  const final = playoff.find(
    (m) => m.round === finalRound && m.home_team_id && m.away_team_id,
  );
  if (!final || final.status !== "live") return null;
  const old = before.matches.find((m) => m.id === final.id);
  if (old?.status === "live") return null; // already live before
  return final;
}

/** Champion = playoff final winner if a bracket exists, else rank-1 standing.
 * (Local copy — narrate is pure and must not import the client `view` module,
 * which pulls in "use client" deps.) */
function championId(state: StateDTO): string | null {
  const playoff = state.matches.filter((m) => m.phase === "playoff");
  if (playoff.length > 0) {
    const finalRound = Math.max(...playoff.map((m) => m.round));
    const final = playoff.find(
      (m) => m.round === finalRound && m.status === "done",
    );
    if (final?.winner_team_id) return final.winner_team_id;
  }
  const top = state.standings.find((s) => s.rank === 1) ?? state.standings[0];
  if (top && top.played > 0) return top.team_id;
  return null;
}
