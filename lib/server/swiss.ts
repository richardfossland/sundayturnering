import "server-only";

import { bumpVersion, db, getMatches, getTeams } from "@/lib/server/store";
import { phaseCarryOver, planSlots } from "@/lib/tournament/schedule";
import { planSwissRound, swissProgress } from "@/lib/tournament/swiss";
import type { Tournament } from "@/lib/types";

/** Legg neste Swiss-runde i databasen: parr (runde 1 etter seed, senere etter
 * tabellen), gi baner og kø-rekkefølge, og med tidsplan klokkeslett fra
 * max(nå, slutten av kampene som ikke er ferdige), med hvile fra lagenes forrige
 * kamper. Kastes det, er ingenting av runden lagret (en delvis innsatt runde
 * slettes igjen), så kalleren kan prøve på nytt. */
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
    // Med tidsplan velger planleggeren banen (tidligste ledige); uten fordeles de jevnt.
    court_id:
      !t.config?.schedule && p.awayId !== null && courtIds.length > 0
        ? courtIds[i % courtIds.length]
        : null,
    queue_order: queue++,
    home_team_id: p.homeId,
    away_team_id: p.awayId,
    status: (p.awayId === null ? "bye" : "scheduled") as "bye" | "scheduled",
    winner_team_id: p.awayId === null ? p.homeId : null,
  }));

  // Tidsplan: runden starter tidligst nå (rundet opp til 5 min), etter kampene som
  // ikke er ferdige, og lagene hviler minst `minRestMinutes` etter sin forrige kamp.
  const schedule = t.config?.schedule;
  let slots = new Map<string, { at: string; courtId: string | null }>();
  if (schedule) {
    const carry = phaseCarryOver(matches, schedule, t.status, Date.now());
    slots = planSlots(
      plain.map((r, i) => ({ ...r, id: String(i) })),
      courtIds,
      schedule,
      { notBefore: new Date(carry.notBefore), priorEnds: carry.teamEnds },
    );
  }
  const rows = plain.map((r, i) => {
    const p = slots.get(String(i));
    return { ...r, court_id: r.court_id ?? p?.courtId ?? null, scheduled_at: p?.at ?? null };
  });

  const { error } = await sb.from("matches").insert(rows);
  if (error) {
    await sb.from("matches").delete().eq("tournament_id", t.id).eq("phase", "league").eq("round", round);
    throw new Error(`insert swiss round: ${error.message}`);
  }
  return rows.length;
}

export type SwissAdvance =
  | { ok: true; round: number }
  | { ok: false; status: number; code: string; data?: Record<string, unknown> };

/** Neste runde, når den forrige er ferdigspilt. To arrangører som trykker samtidig
 * kan ikke legge samme runde to ganger: kravet er en CAS på `tournaments.version`
 * (bare den som får bumpet versjonen fra den lest, bygger runden). */
export async function advanceSwiss(t: Tournament): Promise<SwissAdvance> {
  if (t.status === "finished") return { ok: false, status: 409, code: "turnering_avsluttet" };
  const total = t.config?.swiss?.rounds ?? 0;
  const progress = swissProgress(await getMatches(t.id), total);
  if (progress.round === 0) return { ok: false, status: 400, code: "kunne_ikke_avansere" };
  if (!progress.complete) return { ok: false, status: 409, code: "runden_pagar", data: { count: progress.open } };
  if (progress.round >= total) return { ok: false, status: 409, code: "alle_runder_spilt" };

  const { data: claimed, error } = await db()
    .from("tournaments")
    .update({ version: t.version + 1 })
    .eq("id", t.id)
    .eq("version", t.version)
    .select("id");
  if (error) throw new Error(error.message);
  if (!claimed || claimed.length === 0) return { ok: false, status: 409, code: "konflikt" };

  const round = progress.round + 1;
  await insertSwissRound(t, round);
  await bumpVersion(t.id);
  return { ok: true, round };
}
