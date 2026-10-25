import { ok, fail, readJson, organiserLimit, must, withApi } from "@/lib/server/http";
import { authOrganiserOrAdmin } from "@/lib/server/auth";
import { db, bumpVersion, getMatches } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";

// POST /api/organiser/finish — mark the tournament finished (champion screen).
// Authorised by EITHER the organiser code OR a signed-in admin who owns it.
async function handlePOST(req: Request) {
  const limited = organiserLimit(req);
  if (limited) return limited;
  const body = await readJson<{
    tournamentId?: string;
    organiserCode?: string;
    force?: boolean;
  }>(req);
  const t = await authOrganiserOrAdmin(body?.tournamentId, body?.organiserCode, req);
  if (!t) return fail(403, "feil_arrangorkode");

  // Et påbegynt B-sluttspill / trøsterunde avsluttes ikke ved et uhell: første
  // kall melder hvor mange B-kamper som står igjen, og `force` bekrefter.
  if (body?.force !== true) {
    const open = (await getMatches(t.id)).filter(
      (m) =>
        m.phase === "playoff" &&
        (m.bracket ?? "A") === "B" &&
        m.status !== "done" &&
        m.status !== "bye",
    ).length;
    if (open > 0) return fail(409, "b_sluttspill_pagar", { count: open });
  }

  must(await db().from("tournaments").update({ status: "finished" }).eq("id", t.id));
  await bumpVersion(t.id);
  defer(() => broadcast(channels.tournament(t.id), events.structure, {}), "finish");
  return ok({ ok: true });
}

export const POST = withApi(handlePOST);
