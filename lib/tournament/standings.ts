// League standings (spec §7) — reduce done league matches into a sorted table.
// Pure. Sort: points → score diff (goal/set) → head-to-head → name.

import type {
  Match,
  ScoringConfig,
  StandingRow,
  Team,
} from "@/lib/types";
import { isVoid, leaguePoints, resolve } from "@/lib/tournament/scoring";

interface Acc extends StandingRow {
  name: string;
}

/** Compute standings for the league phase.
 * @param playoffCut top-N teams marked inPlayoff (0 = no cut line). */
export function computeStandings(
  teams: Team[],
  matches: Match[],
  cfg: ScoringConfig,
  playoffCut = 0,
): StandingRow[] {
  const profile = cfg.profile;
  const acc = new Map<string, Acc>();
  for (const t of teams) {
    acc.set(t.id, {
      team_id: t.id,
      name: t.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      points: 0,
      scoreFor: 0,
      scoreAgainst: 0,
      diff: 0,
      rank: 0,
      inPlayoff: false,
    });
  }

  const leagueDone = matches.filter(
    (m) =>
      m.phase === "league" &&
      m.status === "done" &&
      m.result != null &&
      m.away_team_id != null && // byes don't count toward the table
      !isVoid(m.result), // abandoned/annulled matches are voided
  );

  for (const m of leagueDone) {
    const home = acc.get(m.home_team_id!);
    const away = acc.get(m.away_team_id!);
    if (!home || !away) continue;
    const { winner, homeScore, awayScore } = resolve(profile, m.result!, cfg);
    const pts = leaguePoints(m.result!, profile, cfg);

    home.played++;
    away.played++;
    home.scoreFor += homeScore;
    home.scoreAgainst += awayScore;
    away.scoreFor += awayScore;
    away.scoreAgainst += homeScore;
    home.points += pts.home;
    away.points += pts.away;

    if (winner === "draw") {
      home.drawn++;
      away.drawn++;
    } else if (winner === "home") {
      home.won++;
      away.lost++;
    } else {
      away.won++;
      home.lost++;
    }
  }

  for (const r of acc.values()) r.diff = r.scoreFor - r.scoreAgainst;

  // Form guide: each team's results in chronological (queue) order.
  const formMap = new Map<string, ("W" | "D" | "L")[]>();
  const push = (id: string, v: "W" | "D" | "L") => {
    const arr = formMap.get(id) ?? [];
    arr.push(v);
    formMap.set(id, arr);
  };
  for (const m of [...leagueDone].sort((a, b) => a.queue_order - b.queue_order)) {
    const { winner } = resolve(profile, m.result!, cfg);
    push(m.home_team_id!, winner === "draw" ? "D" : winner === "home" ? "W" : "L");
    push(m.away_team_id!, winner === "draw" ? "D" : winner === "away" ? "W" : "L");
  }

  const rows = [...acc.values()];
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.diff !== a.diff) return b.diff - a.diff;
    if (b.scoreFor !== a.scoreFor) return b.scoreFor - a.scoreFor;
    const h2h = headToHead(a.team_id, b.team_id, leagueDone, profile, cfg);
    if (h2h !== 0) return h2h;
    return a.name.localeCompare(b.name, "no");
  });

  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.inPlayoff = playoffCut > 0 && i < playoffCut;
  });

  // Project to the public StandingRow shape (drop the private `name`).
  return rows.map(
    (r): StandingRow => ({
      team_id: r.team_id,
      played: r.played,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      points: r.points,
      scoreFor: r.scoreFor,
      scoreAgainst: r.scoreAgainst,
      diff: r.diff,
      rank: r.rank,
      inPlayoff: r.inPlayoff,
      form: (formMap.get(r.team_id) ?? []).slice(-5),
    }),
  );
}

export interface GroupStanding {
  group_no: number;
  rows: StandingRow[];
}

/** Per-group standings for the group_playoff format. Runs the same reducer
 * (incl. head-to-head + tiebreaks) restricted to each group's teams + matches,
 * marking the top `advancePerGroup` of each group as inPlayoff. */
export function computeGroupStandings(
  teams: Team[],
  matches: Match[],
  cfg: ScoringConfig,
  advancePerGroup: number,
): GroupStanding[] {
  const groupNos = [
    ...new Set(
      teams.map((t) => t.group_no).filter((g): g is number => g != null),
    ),
  ].sort((a, b) => a - b);

  return groupNos.map((g) => ({
    group_no: g,
    rows: computeStandings(
      teams.filter((t) => t.group_no === g),
      matches.filter((m) => m.group_no === g),
      cfg,
      advancePerGroup,
    ),
  }));
}

/** Head-to-head points between exactly two teams (positive → a ahead). */
function headToHead(
  aId: string,
  bId: string,
  matches: Match[],
  profile: ScoringConfig["profile"],
  cfg: ScoringConfig,
): number {
  let aPts = 0;
  let bPts = 0;
  for (const m of matches) {
    const isAB =
      (m.home_team_id === aId && m.away_team_id === bId) ||
      (m.home_team_id === bId && m.away_team_id === aId);
    if (!isAB) continue;
    const pts = leaguePoints(m.result!, profile, cfg);
    if (m.home_team_id === aId) {
      aPts += pts.home;
      bPts += pts.away;
    } else {
      aPts += pts.away;
      bPts += pts.home;
    }
  }
  return bPts - aPts; // higher points ranks first (ascending sort comparator)
}
