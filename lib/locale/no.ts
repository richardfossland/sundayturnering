// Norwegian (Bokmål) UI strings. Single source for all copy.
export const no = {
  brand: "SundayTurnering",
  tagline: "Turneringen din, klar på storskjerm.",

  // landing
  landing: {
    createCta: "Lag ny turnering",
    boardCta: "Åpne tavle",
    controlCta: "Bli med (kontroll)",
    blurb:
      "Kahoot-stil turneringsstyring for skole og arrangement. Én skjerm viser tavla, telefonene registrerer resultater.",
  },

  // pairing
  pair: {
    controlTitle: "Skriv inn kontrollkoden",
    controlHint: "6-sifret kode fra tavla",
    deviceName: "Navn på enhet (valgfritt)",
    deviceNamePlaceholder: "F.eks. «Bane 1-dommer»",
    join: "Koble til",
    joining: "Kobler til …",
    badCode: "Fant ingen turnering med den koden.",
    boardCodeTitle: "Skriv inn tavlekoden",
    attached: "tilkoblet",
    devices: "Tilkoblede enheter",
  },

  // wizard
  wizard: {
    title: "Ny turnering",
    next: "Neste",
    back: "Tilbake",
    create: "Opprett turnering",
    creating: "Oppretter …",
    step: (n: number, total: number) => `Steg ${n} av ${total}`,

    s1Title: "Hva slags turnering?",
    s1Name: "Tittel",
    s1NamePlaceholder: "F.eks. «7. trinn fotballcup»",
    s1Sport: "Idrett",
    s1SportPlaceholder: "F.eks. Fotball",
    chips: ["Fotball", "Volleyball", "Basket", "Innebandy", "Annet"],

    s2Title: "Format",
    formats: {
      league: {
        name: "Liga",
        blurb: "Alle møter alle. Tabell kårer vinneren.",
      },
      league_playoff: {
        name: "Liga + sluttspill",
        blurb: "Serie først, så går de beste til utslagsspill.",
      },
      cup: {
        name: "Cup",
        blurb: "Rett på utslagsspill. Taper du, er du ute.",
      },
    },

    s3Title: "Poengtelling",
    profiles: {
      simple: { name: "Enkel score", blurb: "Ett tall per lag (3–1)." },
      sets: { name: "Sett / perioder", blurb: "Best av flere sett (volley, padel)." },
      winner: { name: "Bare vinner", blurb: "Ingen tall — bare hvem som vant." },
    },
    setsBestOf: "Best av hvor mange sett?",
    allowDraw: "Tillat uavgjort?",
    points: "Poeng (seier / uavgjort / tap)",

    s4Title: "Lag",
    s4Add: "Legg til lag",
    s4Name: "Lagnavn",
    s4HowMany: "Hvor mange lag?",
    s4Generate: "Opprett",
    s4GenerateHint: "Lager nummererte lag du kan gi navn etterpå.",
    s4Bulk: "Lim inn flere (ett navn per linje)",
    s4BulkApply: "Legg til alle",
    s4Min: "Minst 2 lag.",
    s4Count: (n: number) => `${n} lag`,

    s5Title: "Baner & avvikling",
    sequential: "Én kamp om gangen",
    sequentialBlurb: "Kampene spilles etter hverandre.",
    parallel: "Flere baner samtidig",
    parallelBlurb: "Kamper fordeles på navngitte baner.",
    courtCount: "Antall baner",
    courtName: "Banenavn",

    s6Title: "Sluttspill",
    playoffSize: "Hvor mange lag går videre?",
    playoffCapped: (n: number) => `Maks ${n} (antall lag)`,

    s7Title: "Oppsummering",
    summaryFormat: "Format",
    summaryScoring: "Poeng",
    summaryTeams: "Lag",
    summaryCourts: "Baner",
    summaryCreate: "Alt klart? Opprett turneringen.",
  },

  // board
  board: {
    lobby: "Venter på start",
    controlCode: "Kontrollkode",
    scan: "Skann for å registrere resultater",
    nowPlaying: "Nå spiller",
    nextUp: "Neste",
    standings: "Tabell",
    bracket: "Sluttspill",
    champion: "Vinner",
    noMatches: "Ingen kamper ennå",
    bye: "Fri runde",
    court: "Bane",
    round: "Runde",
    final: "Finale",
    semifinal: "Semifinale",
    quarterfinal: "Kvartfinale",
    tbd: "Avventer",
    th: { rank: "#", team: "Lag", p: "K", w: "S", d: "U", l: "T", diff: "±", pts: "P" },
  },

  // control
  control: {
    matches: "Kamper",
    scheduled: "Planlagt",
    live: "Spilles",
    done: "Ferdig",
    allCourts: "Alle baner",
    pinCourt: "Fest til bane",
    unpin: "Løsne",
    enterResult: "Registrer resultat",
    save: "Lagre",
    saving: "Lagrer …",
    saved: "Lagret!",
    edit: "Endre",
    lockedBy: (name: string) => `Redigeres av ${name}`,
    forceTake: "Ta over",
    conflict: "Resultatet ble endret av en annen enhet. Sjekk på nytt.",
    homeWon: "Hjemmelag vant",
    awayWon: "Bortelag vant",
    addSet: "Legg til sett",
    removeSet: "Fjern",
    organiser: "Arrangør",
    organiserCode: "Arrangørkode",
    organiserHint: "Kreves for å endre struktur, overstyre og avansere.",
    advancePlayoff: "Start sluttspill",
    advanceConfirm: "Bygg sluttspillet fra tabellen nå?",
    override: "Overstyr resultat",
    finish: "Avslutt turnering",
    wrongOrganiserCode: "Feil arrangørkode.",
    needOrganiser: "Denne handlingen krever arrangørkoden.",
  },

  common: {
    home: "Hjemme",
    away: "Borte",
    vs: "mot",
    cancel: "Avbryt",
    close: "Lukk",
    loading: "Laster …",
    error: "Noe gikk galt.",
    retry: "Prøv igjen",
  },
} as const;

export type Locale = typeof no;
