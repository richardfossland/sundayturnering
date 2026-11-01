"use client";

import { openBoardWindowRef } from "@/lib/client/boardWindow";
import { supportsWindowPlacement } from "./detect";

export interface TavleVinduResultat {
  /** false = nettleseren blokkerte popup-vinduet. */
  ok: boolean;
  /** true = vinduet ble flyttet til en annen skjerm enn den du står på. */
  placedOnOtherScreen: boolean;
}

// Subsett av Window Management API (ikke i lib.dom ennå).
interface ScreenLike {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}
interface ScreenDetailsLike {
  screens: ScreenLike[];
  currentScreen: ScreenLike;
}

/** Åpner storskjermen (`?visning=tavle`) i et eget, navngitt vindu via
 * `openBoardWindowRef` så kontrollene blir i dette vinduet. Vinduet åpnes
 * SYNKRONT (innenfor brukerbevegelsen — ellers blokkerer popup-blokkere det);
 * først etterpå prøver vi å flytte det til en annen skjerm via Window
 * Management API, og feiler stille hvis tillatelsen nektes. */
export async function openTavleVindu(tournamentId: string): Promise<TavleVinduResultat> {
  const w = openBoardWindowRef(tournamentId, { tavle: true });
  if (!w) return { ok: false, placedOnOtherScreen: false };

  if (!supportsWindowPlacement()) return { ok: true, placedOnOtherScreen: false };
  try {
    const details = await (
      window as unknown as { getScreenDetails: () => Promise<ScreenDetailsLike> }
    ).getScreenDetails();
    const other = details.screens.find((s) => s !== details.currentScreen);
    if (!other) return { ok: true, placedOnOtherScreen: false };
    w.moveTo(other.availLeft, other.availTop);
    w.resizeTo(other.availWidth, other.availHeight);
    return { ok: true, placedOnOtherScreen: true };
  } catch {
    // Tillatelse nektet / API feilet — vinduet er åpent, bare ikke flyttet.
    return { ok: true, placedOnOtherScreen: false };
  }
}
