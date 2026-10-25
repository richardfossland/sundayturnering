import { ok, fail, readJson, organiserLimit, withApi } from "@/lib/server/http";
import { authOrganiserOrAdmin } from "@/lib/server/auth";
import { advanceToPlayoff } from "@/lib/server/playoff";
import { advanceSwiss } from "@/lib/server/swiss";
import { getMatches } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";

// Our own, user-readable reasons thrown by advanceToPlayoff. Anything else is
// a raw DB/driver error: logged server-side, never echoed to the client.
const FRIENDLY = new Set([
  "Sluttspill er ikke konfigurert.",
  "Sluttspillet er allerede startet.",
  "For få lag til sluttspill.",
]);

// POST /api/organiser/advance — build the playoff bracket from league standings.
// Authorised by EITHER the organiser code OR a signed-in admin who owns it
// (spec §5: stop a referee from nuking the bracket).
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
  // Swiss: «advance» legger neste runde (når den forrige er ferdigspilt).
  if (t.format === "swiss") {
    let r;
    try {
      r = await advanceSwiss(t);
    } catch (e) {
      console.error("[advance] swiss", e);
      return fail(400, "kunne_ikke_avansere");
    }
    if (!r.ok) return fail(r.status, r.code, r.data);
    defer(() => broadcast(channels.tournament(t.id), events.structure, {}), "advance");
    return ok({ ok: true, round: r.round });
  }
  if (t.format !== "league_playoff" && t.format !== "group_playoff")
    return fail(400, "ikke_sluttspillformat");
  if (t.status === "playoff" || t.status === "finished")
    return fail(409, "allerede_avansert");
  // Seeding from an unfinished table is allowed, but only on purpose: the
  // first call reports how many league/group matches are still unplayed.
  if (body?.force !== true) {
    const unplayed = (await getMatches(t.id)).filter(
      (m) => m.phase === "league" && m.status !== "done" && m.status !== "bye",
    ).length;
    if (unplayed > 0) return fail(409, "uspilte_kamper", { count: unplayed });
  }

  try {
    await advanceToPlayoff(t);
  } catch (e) {
    console.error("[advance]", e);
    const msg = (e as Error).message;
    return fail(400, "kunne_ikke_avansere", FRIENDLY.has(msg) ? { detail: msg } : undefined);
  }
  defer(() => broadcast(channels.tournament(t.id), events.structure, {}), "advance");
  return ok({ ok: true });
}

export const POST = withApi(handlePOST);
