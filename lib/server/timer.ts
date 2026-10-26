import "server-only";

import { db, getCourts, getMatches } from "@/lib/server/store";
import { timerToClear } from "@/lib/tournament/timer";
import type { Match, Tournament } from "@/lib/types";

/** Nullstill nedtellingen når en kamp er lagret som ferdig, så neste kamp på
 * banen (eller neste i sekvensiell modus) ikke arver gammel tid. Best effort: ET
 * resultat som allerede er lagret skal ikke feile fordi klokka ikke lot seg
 * nullstille. Returnerer om en nedtelling ble fjernet. */
export async function clearTimerAfterDone(t: Tournament, saved: Match): Promise<boolean> {
  try {
    const matches = await getMatches(t.id);
    const target = timerToClear(saved, matches, t.parallelism);
    if (!target) return false;
    if (target === "tournament") {
      if (!t.timer) return false;
      const { error } = await db().from("tournaments").update({ timer: null }).eq("id", t.id);
      if (error) throw error;
      return true;
    }
    const court = (await getCourts(t.id)).find((c) => c.id === target.court);
    if (!court?.timer) return false;
    const { error } = await db().from("courts").update({ timer: null }).eq("id", court.id);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("[clearTimerAfterDone]", e);
    return false;
  }
}
