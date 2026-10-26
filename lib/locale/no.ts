// Norwegian (Bokmål) UI strings. Single source for all copy.
export const no = {
  brand: "SundayTurnering",
  tagline: "Turneringen din, klar på storskjerm.",

  // landing
  landing: {
    createCta: "Lag ny turnering",
    quickCta: "Enkeltkamp",
    quickBlurb: "Én kamp mellom to lag, uten oppsett.",
    boardCta: "Vis på storskjerm",
    boardBlurb: "Har du en skjermkode? Vis turneringen på en ekstra skjerm.",
    controlCta: "Jeg er dommer",
    blurb:
      "Turneringsstyring på storskjerm for skole og arrangement. Én skjerm viser stillingen, telefonene registrerer resultater.",
    rolesLabel: "Velg rolle",
    followNote: "Du trenger ingen kode eller innlogging.",
    organiserTitle: "Jeg arrangerer",
    organiserBlurb: "Lag en turnering, vis den på storskjerm og styr den fra mobilen.",
    refereeTitle: "Jeg er dommer",
    refereeBlurb: "Tast dommerkoden du har fått av arrangøren, så kan du føre resultater.",
    refereeCta: "Tast dommerkode",
    followTitle: "Jeg vil følge med",
    followBlurb: "Skann QR-koden på storskjermen for å se stilling og kamper på mobilen.",
    otherLabel: "Andre valg",
    howTitle: "Slik fungerer det",
    howSteps: [
      { title: "Lag turneringen", body: "Velg format, legg inn lag og baner. Det tar noen minutter." },
      { title: "Vis den på storskjerm", body: "Åpne storskjermen på projektor eller TV. Publikum skanner QR-koden." },
      { title: "Dommerne fører resultater", body: "Dommerne taster dommerkoden på mobilen og fører inn resultatene." },
    ],
  },

  // shared site header
  header: {
    home: "Til forsiden",
    cancel: "Avbryt",
    cancelConfirm: "Avbryte og gå til forsiden? Det du har fylt inn, blir ikke lagret.",
  },

  // quick 1v1 match
  hurtig: {
    title: "Enkeltkamp",
    blurb: "Én kamp mellom to lag, i gang på sekunder. Ingen oppsett.",
    home: "Lag 1",
    away: "Lag 2",
    score: "Med poeng",
    winner: "Bare vinner",
    start: "Start kampen",
    starting: "Starter …",
  },

  // pairing
  pair: {
    controlTitle: "Skriv inn dommerkoden",
    controlHint: "6 siffer",
    controlExplain:
      "Du får koden av arrangøren. Den står også på storskjermen under «Koder og lenker» og på kampkortene.",
    controlCodeLabel: "Dommerkode (6 siffer)",
    boardExplain:
      "Skjermkoden står i Kontrollsenteret til arrangøren. Den brukes for å vise turneringen på en ekstra skjerm.",
    boardCodeLabel: "Skjermkode",
    deviceName: "Navn på enhet (valgfritt)",
    deviceNamePlaceholder: "F.eks. «Bane 1-dommer»",
    join: "Koble til",
    joining: "Kobler til …",
    badCode: "Fant ingen turnering med den koden.",
    codeForOther: "Den koden tilhører en annen turnering.",
    reenterTitle: "Tast dommerkoden",
    reenterHint:
      "Dommerkoden får du av arrangøren (den vises også på storskjermen, under «Koder og lenker»). Den bekrefter at du er dommer før resultater kan registreres.",
    boardCodeTitle: "Skriv inn skjermkoden",
    attached: "tilkoblet",
    devices: "Tilkoblede enheter",
  },

  // organiser page (/arrangor/[id]) + "Mine turneringer" on the landing page
  hub: {
    eyebrow: "Kontrollsenter",
    controlCode: "Dommerkode (gi til dommerne)",
    boardCode: "Skjermkode",
    organiserNote:
      "Ta vare på arrangørkoden — den kreves for å starte sluttspill, overstyre resultater og avslutte. Del bare dommerkoden med dommerne.",
    savedNote:
      "Kodene er lagret på denne enheten. Du finner siden igjen under «Mine turneringer» på forsiden.",
    openBoard: "Vis på storskjerm",
    boardOpened:
      "Storskjermen er åpnet i et eget vindu. Dra det over til projektoren og trykk F (eller fullskjerm-knappen i menyen) for fullskjerm — denne siden blir stående her.",
    boardBlocked: "Nettleseren stoppet det nye vinduet.",
    boardBlockedLink: "Åpne storskjermen i ny fane",
    control: "Før resultater og arrangørverktøy",
    follow: "Kopier lenken «Følg turneringen» (publikum)",
    followCopied: "Lenke kopiert!",
    results: "Resultater og diplom",
    print: "Skriv ut kampprogram og kampkort",
    copy: "trykk for å kopiere",
    copied: "Kopiert!",
    missingTitle: "Kodene finnes ikke på denne enheten",
    missingBody:
      "Kodene lagres bare på enheten som opprettet turneringen. Storskjermen kan åpnes med skjermkoden, og dommere kobler seg til med dommerkoden.",
    gone: "Turneringen finnes ikke lenger (den kan være slettet).",
    mineTitle: "Mine turneringer",
    mineHint: "Lagret på denne enheten",
    mineShowAll: (n: number) => `Vis alle (${n})`,
    mineShowLess: "Vis færre",
    untitled: "Uten tittel",
    forget: "Glem",
    forgetConfirm:
      "Glemme turneringen på denne enheten? Arrangørkoden forsvinner herfra, men turneringen slettes ikke.",
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
      swiss: {
        name: "Sveitsisk system",
        blurb: "Alle spiller like mange runder mot lag som ligger likt på tabellen. Ingen ryker ut.",
      },
      double_elim: {
        name: "Dobbel utslag",
        blurb: "To liv: du er ikke ute før du har tapt to ganger. Vinnerbrakett og taperbrakett.",
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
    pointsLabel: {
      pointsWin: "Poeng for seier",
      pointsDraw: "Poeng for uavgjort",
      pointsLoss: "Poeng for tap",
    },

    s4Title: "Lag",
    s4Add: "Legg til lag",
    s4Name: "Lagnavn",
    s4HowMany: "Hvor mange lag?",
    s4Generate: "Opprett",
    s4GenerateHint: "Lager nummererte lag du kan gi navn etterpå.",
    s4Bulk: "Lim inn lagnavn (ett per linje)",
    s4BulkApply: "Legg til alle",
    s4Draw: "Trekk lag fra deltakerliste",
    s4DrawTeams: "Antall lag",
    s4DrawDo: "Trekk lag",
    s4DrawHint:
      "Lim inn alle deltakerne (ett navn per linje) – de fordeles tilfeldig og jevnt på lagene. Fint for gymtimen!",
    s4Members: (n: number) => `${n} spillere`,
    s4Min: "Minst 2 lag.",
    s4MinDouble: "Dobbel utslag trenger minst 3 lag.",
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
    grandFinalReset: "Omkamp i finalen hvis taperbraketten vinner",
    grandFinalResetHint:
      "Laget fra vinnerbraketten har ikke tapt ennå. Taper det første finale, spilles en avgjørende omkamp.",
    consolation: "Ekstra sluttspill",
    consolationOpts: {
      none: "Ingen",
      b_playoff: "B-sluttspill for resten",
      first_round_losers: "Trøsterunde for førsterunde-tapere",
    } as const,
    consolationHint: {
      none: "Lag som ryker ut eller ikke kommer videre, er ferdige.",
      b_playoff: "Lagene som ikke kom til sluttspillet får et eget B-sluttspill, seedet etter tabellen.",
      first_round_losers: "Taperne av første runde møtes i en egen trøsterunde (frirunder tapper ikke).",
    } as const,
    swissRounds: "Antall runder",
    swissRoundsHint: "Hvor mange runder hvert lag spiller. Neste runde settes opp når den forrige er ferdig.",
    tiebreak: "Ved likt i tabellen",
    tiebreakOpts: { standard: "Standard", uefa: "Innbyrdes først (UEFA)", swiss: "Sveitsisk (Buchholz)" } as const,
    tiebreakHint: {
      standard: "Poeng, målforskjell, scoret, så innbyrdes oppgjør.",
      uefa: "Poeng, så innbyrdes oppgjør mellom lagene som er like, deretter målforskjell.",
      swiss: "Poeng, så Buchholz (summen av poengene motstanderne har fått), deretter Sonneborn-Berger, innbyrdes oppgjør og målforskjell.",
    } as const,
    scheduleToggle: "Lag tidsplan med klokkeslett",
    scheduleBlurb: "Hver kamp får et klokkeslett. Lagene får hvile mellom kampene.",
    scheduleStart: "Første kamp starter",
    scheduleMatch: "Kampvarighet (min)",
    scheduleBreak: "Pause mellom kamper (min)",
    scheduleRest: "Minste hvile per lag (min)",
    groupNeedsFour: "Gruppespill trenger minst 4 lag (to grupper à to).",
    saveTemplate: "Lagre som mal",
    saveTemplateDo: "Lagre",
    templateName: "Navn på mal",
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
    controlCode: "Dommerkode",
    follow: "Følg turneringen",
    scan: "Skann for å registrere resultater",
    nowPlaying: "Nå spiller",
    nextUp: "Neste",
    courts: "Baner",
    calledUp: "Kalt opp",
    plannedAt: (hhmm: string) => `Kl. ${hhmm}`,
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
    roundOf16: "Åttedelsfinale",
    winnerOf: (code: string) => `Vinner av ${code}`,
    loserOf: (code: string) => `Taper av ${code}`,
    bronze: "Bronsefinale",
    bracketA: "A-sluttspill",
    bracketB: "B-sluttspill",
    bracketBCup: "Trøsterunde",
    bracketW: "Vinnerbrakett",
    bracketL: "Taperbrakett",
    bracketGF: "Finale",
    loserRound: "Taperrunde",
    loserFinal: "Taperfinale",
    rematch: "Omkamp",
    winnerB: "Vinner B-sluttspill",
    winnerBCup: "Vinner trøsterunde",
    group: "Gruppe",
    groups: "Grupper",
    tbd: "Avventer",
    th: { rank: "#", team: "Lag", p: "K", w: "S", d: "U", l: "T", diff: "±", pts: "P", form: "Form", buchholz: "Bu" },
    buchholzTitle: "Buchholz: summen av poengene motstanderne har fått",
    swissRound: (r: number, total: number) => `Runde ${r} av ${total}`,
    fullscreen: "Fullskjerm",
    exitFullscreen: "Avslutt fullskjerm",
    codesBtn: "Koder og lenker",
    codesTitle: "Koder og lenker",
    codesControl: "Dommere · dommerkode",
    codesControlHint:
      "Skann QR-koden eller tast dommerkoden på /kontroll for å føre resultater.",
    codesFollow: "Publikum · følg turneringen",
    codesFollowHint: "Skrivebeskyttet visning — trygg å dele med alle i salen.",
    codesBoard: "Skjermkode",
    codesBoardHint:
      "Vis turneringen på en annen skjerm: gå til /tavle og tast skjermkoden.",
    codesCopy: "Kopier lenke",
    codesCopied: "Lenke kopiert!",
    codesLocked: "Kodene er ikke lagret på denne skjermen",
    codesLockedHint:
      "Tast skjermkoden (står i Kontrollsenteret) for å vise dommerkoden her. Den lagres på denne enheten.",
    codesUnlock: "Vis koder",
    codesWrongBoard: "Den skjermkoden hører til en annen turnering.",
  },

  // utskrift (A4): kampprogram, kampkort, banekort
  print: {
    title: "Skriv ut",
    noAccessTitle: "Utskrift krever arrangørkoden",
    noAccessBody:
      "Kampkortene inneholder QR-koder med dommerkoden, så siden åpner bare på enheten som opprettet turneringen. Gå til Kontrollsenteret og logg inn der.",
    toOrganiser: "Til Kontrollsenteret",
    action: "Skriv ut / lagre som PDF",
    choose: "Hva skal skrives ut?",
    programmeCourt: "Kampprogram per bane",
    programmeTeam: "Kampprogram per lag",
    matchCards: "Kampkort (med QR)",
    courtCards: "Banekort (med QR)",
    onlyKnown: "Bare kamper med kjente lag",
    noControlCode:
      "Dommerkoden finnes ikke på denne enheten, så kortene skrives ut uten QR.",
    nothing: "Ingenting å skrive ut med disse valgene.",
    time: "Tid",
    court: "Bane",
    match: "Kamp",
    round: "Runde",
    noCourt: "Uten bane",
    noTime: "–",
    tbd: "Avventer",
    vs: "mot",
    result: "Resultat",
    set: (n: number) => `Sett ${n}`,
    homeWon: "Hjemme vant",
    awayWon: "Borte vant",
    signature: "Dommer (signatur)",
    scan: "Skann for å føre resultatet",
    qrMatchAlt: "QR-kode som åpner kampen for dommeren",
    qrCourtAlt: "QR-kode som åpner banen for dommeren",
    courtCardHow: "Slik gjør du som dommer",
    courtCardSteps: [
      "Skann QR-koden med mobilen.",
      "Du dømmer nå på den banen, og neste kamp står øverst.",
      "Trykk på kampen, før inn resultatet og lagre.",
    ],
    courtCardWarn: "Del ikke dette arket med publikum — QR-koden gir tilgang til å føre resultater.",
  },

  // control
  control: {
    deciderTitle: "Hvem gikk videre?",
    deciderHint: "Lik stilling i en utslagskamp — velg vinneren etter straffer eller forlengning.",
    advanceUnplayed: (n: number) =>
      `${n} ${n === 1 ? "kamp er" : "kamper er"} ikke spilt ennå. Sluttspillet seedes fra tabellen slik den er nå, og de uspilte kampene kan ikke lenger registreres. Starte likevel?`,
    cascadeConfirm: "Fortsette?",
    reopen: "Gjenåpne turneringen",
    reopenConfirm: "Gjenåpne turneringen? Storskjermen går tilbake fra vinnerskjermen, og resultater kan rettes.",
    reopened: "Turneringen er gjenåpnet.",
    matches: "Kamper",
    scheduled: "Planlagt",
    live: "Spilles",
    done: "Ferdig",
    allCourts: "Alle baner",
    pinCourt: "Jeg dømmer på …",
    unpin: "Alle baner",
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
    special: "Walkover, avbrutt eller diskvalifisert",
    specialWalkover: "Walkover (W.O.)",
    specialDq: "Diskvalifisert",
    specialAbandoned: "Avbrutt / annullert",
    specialPickWinner: "Hvilket lag gikk videre?",
    specialAbandonedHint: "Kampen telles ikke i tabellen.",
    specialBack: "Vanlig resultat",
    pickTeam: "Velg lag",

    // referee match controls
    startMatch: "Start kamp",
    matchTimer: "Nedtelling",
    timerStop: "Stopp",
    nextMatch: "Din neste kamp",
    connected: "Tilkoblet",
    editJustSaved: "Endre",
    editWindowGone: "Tidsvinduet er utløpt — be arrangøren om å endre.",

    // referee outbox (A5): results queued on the phone while the net is down
    queuedToast: "Lagret på telefonen – sendes når nettet er tilbake",
    unsentBadge: (n: number) => `Ikke sendt ennå (${n})`,
    unsentRetry: "Prøv nå",
    unsentRetrying: "Sender …",
    unsentCard: (score: string) => `Ikke sendt: ${score}`,
    unsentFailed: "Kunne ikke lagres – registrer på nytt eller si fra til arrangør",
    unsentDismiss: "Fjern",
    unsentSent: "Resultatet er sendt.",
    unsentRejected: "Et lagret resultat kunne ikke sendes, fordi kampen er endret av en annen enhet. Sjekk kampen på nytt.",
    codeRejected: "Dommerkoden ble avvist — tast den på nytt.",
    targetDone: "Den kampen er allerede ferdig.",
    targetNotReady: "Lagene i den kampen er ikke avgjort ennå.",
    targetMissing: "Fant ikke kampen eller banen fra kortet.",
    liveOnBoard: "Stillingen vises live på storskjermen mens du taster",

    organiser: "Arrangør",
    organiserCode: "Arrangørkode",
    organiserHint: "Kreves for å endre struktur, overstyre og avansere.",
    advancePlayoff: "Start sluttspill",
    nextRound: "Start neste runde",
    nextRoundConfirm: "Parre neste runde nå?",
    nextRoundDone: (r: number) => `Runde ${r} er lagt.`,
    advanceConfirm: "Bygg sluttspillet fra tabellen nå?",
    override: "Overstyr resultat",
    finish: "Avslutt turnering",
    finishBOpen: (n: number) =>
      `B-sluttspillet er ikke ferdig (${n} ${n === 1 ? "kamp" : "kamper"} igjen). Avslutte turneringen likevel?`,
    wrongOrganiserCode: "Feil arrangørkode.",
    needOrganiser: "Denne handlingen krever arrangørkoden.",

    shiftTitle: "Forsink eller framskynd kamper",
    shiftCourt: "Bane",
    shiftAllCourts: "Alle baner",
    shiftFrom: "Fra",
    shiftFromNow: "Alle kommende kamper",
    shiftMinutes: "Minutter (− tidligere, + senere)",
    shiftPreview: (n: number) => `${n} ${n === 1 ? "kamp" : "kamper"} flyttes`,
    shiftConfirm: "Bekreft",
    shiftDone: (n: number) => `Tidsplanen er flyttet (${n} ${n === 1 ? "kamp" : "kamper"}).`,

    courtsTitle: "Baner",
    courtLive: "Spiller nå",
    courtCalled: "Kalt opp",
    courtSuggested: "Foreslått neste",
    suggestedTag: "foreslått",
    courtNoSuggestion: "Ingen hvilte lag klare",
    courtEmpty: "Ledig",
    callUp: "Kall opp",
    callUndo: "Angre oppkalling",
    calledDone: (court: string) => `Kalt opp til ${court}.`,
    callUndone: "Oppkallingen er angret.",
    restWarning: (team: string, min: number) => `${team} hviler ${min} min til.`,
    restConfirm: (team: string, min: number) =>
      `${team} hviler ${min} min til. Kalle opp likevel?`,
    calledTo: (court: string) => `Kalt opp til ${court}`,
  },

  // commentator / announcer auto-feed (storskjerm-speaker)
  narrate: {
    badge: "Speaker",
    ttsOn: "Les opp",
    ttsOff: "Les opp",
    ttsOnTitle: "Speaker leser opp (på)",
    ttsOffTitle: "Speaker leser opp (av)",
  },

  // spectator phone view (/se/[id])
  spectator: {
    title: "Følg turneringen",
    intro: "Trykk for å heie – det dukker opp på storskjermen!",
    cheer: "Hei!",
    reactClap: "Applaus",
    reactFire: "Brann",
    reactGoal: "Mål!",
    standings: "Stilling",
    nowPlaying: "Nå spiller",
    nextUp: "Neste",
    nothingLive: "Ingen kamp akkurat nå",
    finished: "Turneringen er ferdig",
  },

  // Sunday Account admin layer (logged-in organiser dashboard)
  admin: {
    // login
    loginTitle: "Logg inn",
    loginLede: "Logg inn med Sunday-kontoen for å styre turneringene dine.",
    loginSend: "Send innloggingslenke",
    loginSending: "Sender …",
    loginSentTo: "Sjekk innboksen til",
    loginSentTail: "— vi har sendt deg en innloggingslenke.",
    loginGoogle: "Logg inn med Google",
    loginError: "Klarte ikke å sende lenken — sjekk adressen og prøv igjen.",
    email: "E-post",

    // dashboard
    title: "Mine turneringer",
    lede: "Turneringer du har opprettet mens du var innlogget.",
    create: "Lag ny turnering",
    empty: "Du har ingen turneringer ennå.",
    emptyHint: "Opprett én, så dukker den opp her.",
    loading: "Laster turneringer …",
    loadError: "Klarte ikke å hente turneringene.",
    signOut: "Logg ut",

    // per-row actions
    openBoard: "Storskjerm",
    openControl: "Før resultater",
    edit: "Endre",
    save: "Lagre",
    saving: "Lagrer …",
    cancel: "Avbryt",
    titleLabel: "Tittel",
    sportLabel: "Idrett",
    reopen: "Gjenåpne",
    reopening: "Gjenåpner …",
    delete: "Slett",
    deleting: "Sletter …",
    deleteConfirm: (name: string) =>
      `Slette «${name}» for godt? Dette kan ikke angres.`,
    actionError: "Handlingen feilet. Prøv igjen.",

    // status labels
    status: {
      setup: "Ikke startet",
      league: "Seriespill pågår",
      playoff: "Sluttspill pågår",
      finished: "Ferdig",
    },
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

  // NumberField (lib/client/NumberField.tsx)
  field: {
    less: "Mindre",
    more: "Mer",
    max: (n: number) => `Maks ${n}`,
    min: (n: number) => `Minst ${n}`,
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

  championHeadline: (team: string) => `${team} vinner turneringen!`,
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
