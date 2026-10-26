import { ok, fail, readJson, organiserLimit, must, withApi } from "@/lib/server/http";
import { authOrganiserOrAdmin } from "@/lib/server/auth";
import { db, bumpVersion, getMatches } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { BRONZE_SLOT } from "@/lib/tournament/bracket";
import { pendingFinals } from "@/lib/tournament/consolation";

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

  // Et påbegynt B-sluttspill / trøsterunde, eller en bronsefinale som kan spilles,
  // avsluttes ikke ved et uhell: første kall melder hvor mange kamper som står
  // igjen, og `force` bekrefter. (Etter migrasjon 0020 holder turneringen seg åpen
  // til bronsefinalen er spilt, så «Avslutt» her er den bevisste snarveien.)
  if (body?.force !== true) {
    const matches = await getMatches(t.id);
    let open = matches.filter(
      (m) =>
        m.phase === "playoff" &&
        (m.bracket ?? "A") === "B" &&
        m.status !== "done" &&
        m.status !== "bye",
    ).length;
    // Bronsefinalen (A, slot 1, mates av taper-koblinger) regnes når begge lag er
    // kjent. Koblingene hentes bare når en slik kandidat finnes.
    const candidates = matches.filter(
      (m) =>
        m.phase === "playoff" &&
        (m.bracket ?? "A") === "A" &&
        m.bracket_slot === BRONZE_SLOT &&
        m.status !== "done" &&
        m.status !== "bye" &&
        m.home_team_id &&
        m.away_team_id,
    );
    if (candidates.length > 0) {
      const { data: links } = await db()
        .from("bracket_links")
        .select("from_match_id,to_match_id,feed")
        .eq("tournament_id", t.id);
      open += pendingFinals(candidates, links ?? []).length;
    }
    if (open > 0) return fail(409, "b_sluttspill_pagar", { count: open });
  }

  must(await db().from("tournaments").update({ status: "finished" }).eq("id", t.id));
  await bumpVersion(t.id);
  defer(() => broadcast(channels.tournament(t.id), events.structure, {}), "finish");
  return ok({ ok: true });
}

export const POST = withApi(handlePOST);
