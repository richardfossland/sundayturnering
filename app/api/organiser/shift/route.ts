import { ok, fail, readJson, organiserLimit, isUuid, withApi } from "@/lib/server/http";
import { authOrganiserOrAdmin } from "@/lib/server/auth";
import { db, getMatches } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { previewShift, type ShiftError } from "@/lib/tournament/schedule";

// POST /api/organiser/shift — flytt tidsplanen (alle baner eller én) fra et
// tidspunkt. Authorised by EITHER the organiser code OR a signed-in admin who
// owns it. Reglene valideres her (previewShift) for pene feil og igjen,
// atomisk, i RPC-en shift_schedule (migrasjon 0013).
const STATUS: Record<ShiftError, number> = {
  ugyldig_skyv: 400,
  for_stort_skyv: 400,
  skyv_for_tidlig: 409,
  ingen_kamper: 409,
};

async function handlePOST(req: Request) {
  const limited = organiserLimit(req);
  if (limited) return limited;
  const body = await readJson<{
    tournamentId?: string;
    organiserCode?: string;
    courtId?: string | null;
    from?: string;
    minutes?: number;
  }>(req);
  const t = await authOrganiserOrAdmin(body?.tournamentId, body?.organiserCode, req);
  if (!t) return fail(403, "feil_arrangorkode");
  if (!t.config?.schedule) return fail(400, "ingen_tidsplan");

  const courtId = body?.courtId ?? null;
  if (courtId !== null && !isUuid(courtId)) return fail(400, "ugyldig_skyv");
  const fromIso = typeof body?.from === "string" ? body.from : "";
  const minutes = typeof body?.minutes === "number" ? body.minutes : NaN;

  const { error } = previewShift(await getMatches(t.id), {
    courtId,
    fromIso,
    minutes,
    nowIso: new Date().toISOString(),
  });
  if (error) return fail(STATUS[error], error);

  const rpc = await db().rpc("shift_schedule", {
    p_tournament: t.id,
    p_court: courtId,
    p_from: new Date(fromIso).toISOString(),
    p_minutes: minutes,
  });
  // The DB re-checks under the row lock (clock / concurrent changes).
  if (rpc.error?.code === "P0422") {
    if (rpc.error.message === "shift_too_large") return fail(400, "for_stort_skyv");
    if (rpc.error.message === "shift_in_past") return fail(409, "skyv_for_tidlig");
    return fail(400, "ugyldig_skyv");
  }
  if (rpc.error) throw rpc.error;

  defer(() => broadcast(channels.tournament(t.id), events.structure, {}), "shift");
  return ok({ ok: true, count: Number(rpc.data ?? 0) });
}

export const POST = withApi(handlePOST);
