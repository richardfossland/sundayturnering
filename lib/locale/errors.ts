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
  for_mange_forsok: "For mange forsøk — vent et minutt og prøv igjen.",
  rate_limited: "For mange forsøk — vent et minutt og prøv igjen.",
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
  // organiser
  allerede_avansert: "Sluttspillet er allerede startet.",
  ikke_sluttspillformat: "Denne turneringen har ikke sluttspill.",
  ikke_avsluttet: "Turneringen er ikke avsluttet.",
  finnes_ikke: "Fant ikke turneringen.",
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.detail) return e.detail;
    return MESSAGES[e.code] ?? no.common.error;
  }
  // fetch() rejects with a TypeError when the network is down
  if (e instanceof TypeError) return "Ingen forbindelse — sjekk nettet og prøv igjen.";
  return no.common.error;
}
