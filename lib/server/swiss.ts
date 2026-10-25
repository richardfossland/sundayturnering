import "server-only";

import { db, getMatches, getTeams } from "@/lib/server/store";
import { assignSlots, matchEnd } from "@/lib/tournament/schedule";
import { planSwissRound } from "@/lib/tournament/swiss";
import type { Tournament } from "@/lib/types";

/** Legg neste Swiss-runde i databasen: parr (runde 1 etter seed, senere etter
 * tabellen), gi baner og kø-rekkefølge, og med tidsplan klokkeslett fra
 * max(nå, slutten av forrige runde). Kastes det, er ingenting av runden lagret
 * (en delvis innsatt runde slettes igjen), så kalleren kan prøve på nytt. */
export async function insertSwissRound(t: Tournament, round: number): Promise<number> {
  const sb = db();
  const [teams, matches] = await Promise.all([getTeams(t.id), getMatches(t.id)]);
  const courtIds = (
    t.parallelism === "parallel"
      ? ((await sb.from("courts").select("id,sort_order").eq("tournament_id", t.id)).data ?? [])
      : []
  )
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => c.id as string);

  const pairings = planSwissRound(teams, matches, t.scoring, t.config?.tiebreak);
  let queue = matches.reduce((mx, m) => Math.max(mx, m.queue_order), -1) + 1;
  const plain = pairings.map((p, i) => ({
    tournament_id: t.id,
    phase: "league" as const,
    round,
    bracket_slot: null,
    court_id: p.awayId !== null && courtIds.length > 0 ? courtIds[i % courtIds.length] : null,
    queue_order: queue++,
    home_team_id: p.homeId,
    away_team_id: p.awayId,
    status: (p.awayId === null ? "bye" : "scheduled") as "bye" | "scheduled",
    winner_team_id: p.awayId === null ? p.homeId : null,
  }));

  // Tidsplan: runden starter tidligst nå (rundet opp til 5 min) og etter at forrige runde er slutt.
  const schedule = t.config?.schedule;
  let slots = new Map<string, string>();
  if (schedule) {
    const FIVE = 5 * 60_000;
    let from = Math.ceil(Date.now() / FIVE) * FIVE;
    for (const m of matches) from = Math.max(from, matchEnd(m.scheduled_at, schedule) ?? 0);
    slots = assignSlots(
      plain.map((r, i) => ({ ...r, id: String(i) })),
      courtIds,
      schedule,
      { notBefore: new Date(from) },
    );
  }
  const rows = plain.map((r, i) => ({ ...r, scheduled_at: slots.get(String(i)) ?? null }));

  const { error } = await sb.from("matches").insert(rows);
  if (error) {
    await sb.from("matches").delete().eq("tournament_id", t.id).eq("phase", "league").eq("round", round);
    throw new Error(`insert swiss round: ${error.message}`);
  }
  return rows.length;
}
