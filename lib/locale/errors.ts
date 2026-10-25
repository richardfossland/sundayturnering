// API error code → something a teacher can act on. The routes answer with a
// stable snake_case code (+ sometimes a Norwegian `detail`); the UI used to
// show "Noe gikk galt." for all of them. `detail` wins when the server sent
// one — it is already written for the user (e.g. result validation).

import { ApiError } from "@/lib/client/api";
import { no } from "./no";

const MESSAGES: Record<string, string> = {
  // create
  minst_to_lag: "En turnering trenger minst to lag.",
  for_mange_lag: "For mange lag — maks 64.",
  for_fa_lag_dobbel: "Dobbel utslag trenger minst tre lag.",
  for_mange_lag_dobbel: "Dobbel utslag støtter maks 32 lag.",
  lag_mangler_navn: "Alle lag må ha et navn.",
  for_mange_grupper: "For mange grupper for antall lag — hver gruppe trenger minst to lag.",
  ugyldig_antall_grupper: "Velg mellom 2 og 8 grupper.",
  ugyldig_antall_videre: "Velg hvor mange som går videre fra hver gruppe (1–4).",
  ugyldig_format: "Ukjent turneringsformat.",
  ugyldig_poeng: "Velg en poengtelling.",
  kunne_ikke_opprette: "Klarte ikke å opprette turneringen. Prøv igjen.",
  // upload
  for_stor: "Bildet er for stort (maks 2 MB).",
  ugyldig_filtype: "Bare PNG-, JPG- eller WebP-bilder.",
  kunne_ikke_laste_opp: "Klarte ikke å laste opp bildet.",
  // codes / auth
  feil_kontrollkode: "Feil kontrollkode.",
  feil_arrangorkode: no.control.wrongOrganiserCode,
  ugyldig_kode: "Ugyldig kode.",
  for_mange_forsok: "For mange forsøk – vent litt og prøv igjen.",
  rate_limited: "For mange forsøk — vent et minutt og prøv igjen.",
  midlertidig_feil: "Midlertidig feil – prøv igjen om litt.",
  // match flow
  konflikt: "Resultatet ble endret av en annen enhet.",
  kamp_ferdig: "Kampen er allerede ferdig.",
  kamp_ikke_klar: "Kampen mangler et lag ennå.",
  kamp_ikke_live: "Kampen er ikke i gang.",
  laast_av_annen: "En annen enhet registrerer denne kampen.",
  turnering_avsluttet: "Turneringen er avsluttet. Arrangøren kan gjenåpne den.",
  serien_avsluttet: "Serien er over — sluttspillet er i gang.",
  neste_kamp_spilt: "Neste sluttspillkamp har allerede startet.",
  for_sent: "Det er for sent å rette selv — be arrangøren endre resultatet.",
  ikke_din_kamp: "Bare enheten som lagret resultatet kan rette det.",
  kunne_ikke_lagre: "Klarte ikke å lagre. Prøv igjen.",
  // network
  tidsavbrudd: "Tjenesten svarer ikke — sjekk nettet og prøv igjen.",
  // organiser
  allerede_avansert: "Sluttspillet er allerede startet.",
  ikke_sluttspillformat: "Denne turneringen har ikke sluttspill.",
  ikke_avsluttet: "Turneringen er ikke avsluttet.",
  finnes_ikke: "Fant ikke turneringen.",
  ingen_tidsplan: "Turneringen har ingen tidsplan.",
  ugyldig_skyv: "Ugyldig skyv — oppgi et helt antall minutter (ikke 0).",
  for_stort_skyv: "Du kan skyve høyst 240 minutter om gangen.",
  skyv_for_tidlig: "Kamper kan ikke flyttes til før klokka nå.",
  ingen_kamper: "Ingen kamper å skyve fra det tidspunktet.",
  // call-up (A3)
  bane_finnes_ikke: "Banen finnes ikke i denne turneringen.",
  bane_opptatt: "Banen er opptatt — en kamp pågår eller er allerede kalt opp.",
  lag_opptatt: "Et av lagene spiller eller er kalt opp til en annen bane.",
  ikke_kalt_opp: "Kampen er ikke kalt opp.",
};

/** Pairing screens (control/board code entry): a wrong code reads «fant ingen
 * turnering», but a 429 (too many wrong guesses from this network) must say so
 * — it is not «feil kode». */
export function pairErrorMessage(e: unknown, only404 = false): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return MESSAGES.for_mange_forsok;
    // A timeout (0) or server trouble (5xx) says nothing about the code —
    // telling the user it was wrong would send them hunting for a typo.
    if (e.status === 0 || e.status >= 500) return errorMessage(e);
    if (!only404 || e.status === 404) return no.pair.badCode;
  }
  return errorMessage(e); // offline TypeError → «Ingen forbindelse», else generic
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.detail) return e.detail;
    return MESSAGES[e.code] ?? no.common.error;
  }
  // fetch() rejects with a TypeError when the network is down
  if (e instanceof TypeError) return "Ingen forbindelse — sjekk nettet og prøv igjen.";
  return no.common.error;
}
