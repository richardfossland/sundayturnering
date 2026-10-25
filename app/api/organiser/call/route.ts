import { ok, fail, readJson, organiserLimit, isUuid, withApi } from "@/lib/server/http";
import { authOrganiserOrAdmin } from "@/lib/server/auth";
import { db, getCourts, getMatches } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { callError, type CallError } from "@/lib/tournament/courts";

// POST /api/organiser/call — kall en kamp opp til en bane (status `called`), eller
// angre oppkallingen (`undo`). Authorised by EITHER the organiser code OR a
// signed-in admin who owns it. Reglene forhåndssjekkes her (callError) for pene
// feil og håndheves igjen, atomisk, i RPC-ene call_match/uncall_match (migr. 0014).
const STATUS: Record<CallError, number> = {
  kamp_ikke_klar: 409,
  bane_finnes_ikke: 404,
  bane_opptatt: 409,
  lag_opptatt: 409,
};

async function handlePOST(req: Request) {
  const limited = organiserLimit(req);
  if (limited) return limited;
  const body = await readJson<{
    tournamentId?: string;
    organiserCode?: string;
    matchId?: string;
    courtId?: string;
    undo?: boolean;
  }>(req);
  const t = await authOrganiserOrAdmin(body?.tournamentId, body?.organiserCode, req);
  if (!t) return fail(403, "feil_arrangorkode");
  if (!isUuid(body?.matchId)) return fail(400, "mangler_felt");
  const matchId = body.matchId;
  const undo = body.undo === true;
  if (!undo && !isUuid(body.courtId)) return fail(400, "mangler_felt");

  // A finished tournament takes no new play.
  if (t.status === "finished") return fail(409, "turnering_avsluttet");

  const matches = await getMatches(t.id);
  const match = matches.find((m) => m.id === matchId);
  if (!match) return fail(404, "finnes_ikke");

  if (undo) {
    if (match.status !== "called") return fail(409, "ikke_kalt_opp");
    const rpc = await db().rpc("uncall_match", { p_match: matchId });
    if (rpc.error?.code === "P0422") return fail(409, "ikke_kalt_opp");
    if (rpc.error) throw rpc.error;
  } else {
    const courtId = body.courtId as string;
    const err = callError(match, courtId, await getCourts(t.id), matches);
    if (err) return fail(STATUS[err], err);
    const rpc = await db().rpc("call_match", { p_match: matchId, p_court: courtId });
    // The DB re-checks under the row locks (concurrent calls).
    if (rpc.error?.code === "P0422") {
      if (rpc.error.message === "court_busy") return fail(409, "bane_opptatt");
      if (rpc.error.message === "court_not_found") return fail(404, "bane_finnes_ikke");
      return fail(409, "kamp_ikke_klar");
    }
    if (rpc.error) throw rpc.error;
  }

  defer(() => broadcast(channels.tournament(t.id), events.structure, {}), "call");
  return ok({ ok: true });
}

export const POST = withApi(handlePOST);
