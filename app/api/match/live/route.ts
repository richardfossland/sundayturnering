import { ok, fail, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { db, getMatch, getTournament } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { authControlCode } from "@/lib/server/auth";
import { channels, events } from "@/lib/realtime";
import { validateLiveResult, canonicaliseLiveResult } from "@/lib/tournament/scoring";

// POST /api/match/live — push an IN-PROGRESS score to the board while the match
// is live. Purely presentational: `matches.result` is updated but the match
// stays `live`, winner_team_id stays null and result_version is untouched, so
// standings ignore it and the final submit (the guarded RPC) overwrites it.
// Last-write-wins is fine for a running score. Referee credential required.
export async function POST(req: Request) {
  if (!rateLimit(`match-live:${clientIp(req)}`, 240, 60_000))
    return fail(429, "for_mange_forsok");
  const body = await readJson<{
    matchId?: string;
    result?: Record<string, unknown>;
    deviceId?: string;
    controlCode?: string;
  }>(req);
  if (!body?.matchId || !body.result) return fail(400, "mangler_felt");

  const m = await getMatch(body.matchId);
  if (!m) return fail(404, "finnes_ikke");
  const t = await getTournament(m.tournament_id);
  if (!t) return fail(404, "finnes_ikke");
  if (!authControlCode(t, body.controlCode)) return fail(403, "feil_kontrollkode");
  if (m.status !== "live") return fail(409, "kamp_ikke_live");

  const err = validateLiveResult(t.scoring.profile, body.result);
  if (err) return fail(422, "ugyldig_resultat", { detail: err });
  const result = canonicaliseLiveResult(t.scoring.profile, body.result);

  // Guarded on status so a result that lands between our read and this write
  // (the match just finished) is never overwritten by a stale interim score.
  const { error } = await db()
    .from("matches")
    .update({ result })
    .eq("id", m.id)
    .eq("status", "live");
  if (error) {
    console.error("[live]", error);
    return fail(500, "kunne_ikke_lagre");
  }

  defer(
    () => broadcast(channels.tournament(m.tournament_id), events.matchUpdated, { matchId: m.id, live: true }),
    "live",
  );
  return ok({ ok: true, result });
}
