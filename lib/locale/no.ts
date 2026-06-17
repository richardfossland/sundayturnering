// Norwegian (Bokmål) UI strings. Single source for all copy.
export const no = {
  brand: "SundayTurnering",
  tagline: "Turneringen din, klar på storskjerm.",

  // landing
  landing: {
    createCta: "Lag ny turnering",
    quickCta: "⚡ Hurtigkamp (1v1)",
    boardCta: "Åpne tavle",
    controlCta: "Bli med (kontroll)",
    blurb:
      "Kahoot-stil turneringsstyring for skole og arrangement. Én skjerm viser tavla, telefonene registrerer resultater.",
  },

  // quick 1v1 match
  hurtig: {
    title: "Hurtigkamp",
    blurb: "Én kamp, to lag, i gang på sekunder. Ingen oppsett.",
    home: "Lag 1",
    away: "Lag 2",
    score: "Med poeng",
    winner: "Bare vinner",
    start: "Start kampen",
    starting: "Starter …",
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
      group_playoff: {
        name: "Gruppespill",
        blurb: "Lagene deles i grupper, så går de beste til sluttspill.",
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
    s4Bulk: "Lim inn lagnavn (ett per linje)",
    s4BulkApply: "Legg til alle",
    s4Draw: "🎲 Trekk lag fra deltakerliste",
    s4DrawTeams: "Antall lag",
    s4DrawDo: "Trekk lag",
    s4DrawHint:
      "Lim inn alle deltakerne (ett navn per linje) – de fordeles tilfeldig og jevnt på lagene. Fint for gymtimen!",
    s4Members: (n: number) => `${n} spillere`,
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
    groupCount: "Antall grupper",
    advancePerGroup: "Videre fra hver gruppe",
    thirdPlace: "Spill om 3.-plass (bronsefinale)",
    groupPreview: (groups: number, per: number) =>
      `${groups} grupper · ${per} videre fra hver → ${groups * per} i sluttspill`,

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
    follow: "Følg live",
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
    bronze: "Bronsefinale",
    group: "Gruppe",
    groups: "Grupper",
    tbd: "Avventer",
    th: { rank: "#", team: "Lag", p: "K", w: "S", d: "U", l: "T", diff: "±", pts: "P", form: "Form" },
    codesBtn: "Koder og lenker",
    codesTitle: "Koder og lenker",
    codesControl: "Dommere · kontroll",
    codesControlHint:
      "Skann QR-koden eller tast kontrollkoden på /kontroll for å registrere resultater.",
    codesFollow: "Publikum · følg live",
    codesFollowHint: "Skrivebeskyttet visning — trygg å dele med alle i salen.",
    codesBoard: "Tavlekode",
    codesBoardHint:
      "Åpne tavla på en annen skjerm: gå til /tavle og tast tavlekoden.",
    codesCopy: "Kopier lenke",
    codesCopied: "Lenke kopiert!",
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
    reset: "Nullstill",
    setsTally: (h: number, a: number) => `Sett: ${h}–${a}`,
    bestOf: (n: number) => `Best av ${n}`,
    matchPoint: "Avgjørende sett",

    // special results (walkover / abandoned / disqualification)
    special: "Spesialresultat",
    specialWalkover: "Walkover (W.O.)",
    specialDq: "Diskvalifisert",
    specialAbandoned: "Avbrutt / annullert",
    specialPickWinner: "Hvilket lag gikk videre?",
    specialAbandonedHint: "Kampen telles ikke i tabellen.",
    specialBack: "← Vanlig resultat",
    pickTeam: "Velg lag",

    // referee match controls
    startMatch: "Start kamp",
    matchTimer: "Kamp-timer",
    timerStop: "Stopp",
    nextMatch: "Din neste kamp",
    connected: "Tilkoblet",
    editJustSaved: "Endre",
    editWindowGone: "Tidsvinduet er utløpt — be arrangøren om å endre.",

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

  // commentator / announcer auto-feed (storskjerm-speaker)
  narrate: {
    badge: "Speaker",
    ttsOn: "Les opp",
    ttsOff: "Les opp",
    ttsOnTitle: "Speaker leser opp (på)",
    ttsOffTitle: "Speaker leser opp (av)",
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

// Commentator copy table (storskjerm-speaker). Kept separate from `no` because
// these are builder *functions* consumed by the pure narrate module — church/
// community-appropriate, energetic but never mocking the losing team.
export const narr = {
  unknownTeam: "Ukjent lag",

  resultHeadline: (winner: string, loser: string) =>
    `${winner} slo ${loser}!`,
  routHeadline: (winner: string, loser: string, margin: number) =>
    `Klar beskjed: ${winner} valset ${loser} med ${margin}!`,
  upsetHeadline: (winner: string, loser: string) =>
    `Sensasjon! ${winner} felte ${loser}!`,
  drawHeadline: (home: string, away: string) =>
    `Uavgjort mellom ${home} og ${away}.`,

  liveHeadline: (home: string, away: string) =>
    `Nå braker det løs: ${home} mot ${away}!`,

  leadHeadline: (team: string) => `${team} tar ledelsen på tabellen!`,
  leadDetail: (points: number) => `${points} poeng på topp.`,

  clinchHeadline: (team: string) => `${team} er klare for sluttspill!`,

  playoffHeadline: "Sluttspillet er i gang!",
  playoffDetail: "De beste lagene kjemper om seieren.",

  finalHeadline: (home: string, away: string) =>
    `Finale! ${home} mot ${away} om tittelen.`,

  championHeadline: (team: string) => `${team} vinner turneringen! 🏆`,
  championDetail: "Gratulerer til vinneren – og takk for kampen, alle sammen!",
} as const;

// Awards / superlatives copy (sport-agnostic). Energetic, never mocking.
export const aw = {
  title: "Utmerkelser",
  teamOfNight: "Kveldens lag",
  mostWins: "Flest seire",
  biggestWin: "Største seier",
  highestScoring: "Mest målrike kamp",
  bestAttack: "Skarpest angrep",
  bestDefense: "Tettest forsvar",
  wins: (n: number) => `${n} ${n === 1 ? "seier" : "seire"}`,
  scored: (n: number) => `${n} scoret`,
  conceded: (n: number) => `${n} sluppet inn`,
} as const;
