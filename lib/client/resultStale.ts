// L4/C7: dommerens åpne resultatvindu. Resultatet som tastes inn hører til
// PARET som sto i kampen da vinduet ble åpnet. Bytter lagene plass mens vinduet
// er åpent (overstyring med kaskade, bytte av plass), skal «Lagre» ikke stilltiende
// godta den nye versjonen og kreditere poengene til de nye lagene.

export interface Pairing {
  home: string | null;
  away: string | null;
}

export const pairingOf = (m: { home_team_id: string | null; away_team_id: string | null }): Pairing => ({
  home: m.home_team_id,
  away: m.away_team_id,
});

/** Har paret i kampen endret seg siden vinduet ble åpnet? */
export function teamsChangedSince(
  base: Pairing,
  m: { home_team_id: string | null; away_team_id: string | null },
): boolean {
  return base.home !== m.home_team_id || base.away !== m.away_team_id;
}

/** Versjonen vinduet skal sende: følger den ferskeste kampen (så en urelatert
 * refetch ikke gir falsk konflikt), men står stille når paret er byttet — da
 * blir innsendingen stoppet i stedet. */
export function versionToSend(current: number, fresh: number, teamsChanged: boolean): number {
  return teamsChanged ? current : fresh;
}
