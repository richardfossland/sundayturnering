import { ok, fail, readJson, organiserLimit } from "@/lib/server/http";
import { authOrganiserOrAdmin } from "@/lib/server/auth";
import { reopenTournament } from "@/lib/server/playoff";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";

// POST /api/organiser/reopen — un-finish a tournament with the organiser code
// (or as the signed-in owner). Before this only the admin route could reopen,
// so an accidental "Avslutt" on an anonymous tournament was permanent.
export async function POST(req: Request) {
  const limited = organiserLimit(req);
  if (limited) return limited;
  const body = await readJson<{ tournamentId?: string; organiserCode?: string }>(req);
  const t = await authOrganiserOrAdmin(body?.tournamentId, body?.organiserCode);
  if (!t) return fail(403, "feil_arrangorkode");
  if (t.status !== "finished") return fail(409, "ikke_avsluttet");

  const status = await reopenTournament(t);
  defer(() => broadcast(channels.tournament(t.id), events.structure, {}), "reopen");
  return ok({ ok: true, status });
}
