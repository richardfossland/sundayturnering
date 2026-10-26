// Hvem er mester? (ren modul — delt av storskjerm, resultatside og speaker, så de
// aldri er uenige.) Vinneren av finalen i hovedbraketten (A, bracket_slot 0 i siste
// runde; bronsefinalen deler runde, men kårer aldri en mester). Finnes et sluttspill
// som ikke er avgjort, finnes ingen mester ennå — turneringen kan ikke falle tilbake
// til tabelleder, som kan ha røket ut i kvartfinalen.

import type { StateDTO } from "@/lib/dto";
import { doubleElimOutcome } from "@/lib/tournament/doubleElim";

/** The champion's team id, or null while undecided (also after an early finish
 * before the final was played). Pure league / Swiss: the table leader once played. */
export function championId(state: StateDTO): string | null {
  const { format } = state.tournament;
  if (format === "double_elim") return doubleElimOutcome(state.matches)?.champion ?? null;
  const playoff = state.matches.filter(
    (m) => m.phase === "playoff" && (m.bracket ?? "A") === "A",
  );
  if (playoff.length > 0) {
    const finalRound = Math.max(...playoff.map((m) => m.round));
    const final = playoff.find(
      (m) => m.round === finalRound && m.bracket_slot === 0 && m.status === "done",
    );
    return final?.winner_team_id ?? null;
  }
  // Sluttspill-format uten bygd sluttspill har ingen mester: tabellen (i grupper en
  // blanding av grupper som aldri møtte hverandre) kårer ingen.
  if (format !== "league" && format !== "swiss") return null;
  const top = state.standings[0];
  return top && top.played > 0 && state.standings.some((s) => s.played > 0) ? top.team_id : null;
}
