"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { SiteHeader } from "@/lib/client/SiteHeader";
import { NumberField } from "@/lib/client/NumberField";
import { paletteColour } from "@/lib/palette";
import { isoToOsloLocal, nextOsloHourLocal, osloLocalToIso } from "@/lib/tournament/osloTime";
import {
  allEmblemsShuffled,
  emblemDataUri,
  isEmblem,
  EMBLEM_COUNT,
} from "@/lib/emblems";
import {
  templates,
  timeOfDay,
  withTimeOfDay,
  type Template,
  type TemplateData,
} from "@/lib/client/templates";
import { defaultScoringConfig } from "@/lib/tournament/scoring";
import {
  roundRobinMatchCount,
  roundRobinRoundCount,
} from "@/lib/tournament/roundRobin";
import type {
  Consolation,
  Format,
  Parallelism,
  ScoringConfig,
  ScoringProfileKey,
  TiebreakPreset,
} from "@/lib/types";
import { myTournaments } from "@/lib/client/myTournaments";
import { errorMessage } from "@/lib/locale/errors";
import { clampGroupCount, clampPlayoffSize } from "@/lib/tournament/playoffSize";
import { defaultSwissRounds, maxSwissRounds } from "@/lib/tournament/swiss";
import { consolationOptions, cupConsolationFeasible } from "@/lib/tournament/consolation";
import { estimateEnd } from "@/lib/tournament/estimate";
import { Stepper } from "./Stepper";

interface DraftTeam {
  name: string;
  colour: string;
  logo_url: string | null;
  members: string[];
}

/** Fixed: the Sluttspill step is skipped (not removed) for formats without one. */
const TOTAL = 7;
const PLAYOFF_STEP = 6;
const SUMMARY_STEP = 7;
const FORMATS: Format[] = ["league", "league_playoff", "group_playoff", "cup", "double_elim", "swiss"];
const QUICK_COUNTS = [4, 6, 8, 10, 12, 16];

type TeamTab = "write" | "paste" | "draw";

export function Wizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  // After «Endre» in the summary, «Neste» jumps straight back to it.
  const [fromSummary, setFromSummary] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [tmplName, setTmplName] = useState<string | null>(null); // null = closed
  const [tmplSaved, setTmplSaved] = useState(false);

  // draft
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState("");
  const [format, setFormat] = useState<Format>("league");
  const [scoring, setScoring] = useState<ScoringConfig>(defaultScoringConfig("simple"));
  const [parallelism, setParallelism] = useState<Parallelism>("sequential");
  const [courtCount, setCourtCount] = useState(2);
  const [courtNames, setCourtNames] = useState<string[]>(["Bane 1", "Bane 2"]);
  const [playoffSize, setPlayoffSize] = useState<2 | 4 | 8>(4);
  const [groupCount, setGroupCount] = useState(2);
  const [advancePerGroup, setAdvancePerGroup] = useState(2);
  const [thirdPlace, setThirdPlace] = useState(false);
  const [consolation, setConsolation] = useState<Consolation>("none");
  const [grandFinalReset, setGrandFinalReset] = useState(true);
  const [tiebreak, setTiebreak] = useState<TiebreakPreset>("standard");
  // Swiss: antall runder; null = standard (ceil(log2 N)).
  const [swissRounds, setSwissRounds] = useState<number | null>(null);
  // Valgfri tidsplan (av som standard). Starttid i lokal tid, "YYYY-MM-DDTHH:mm".
  const [scheduleOn, setScheduleOn] = useState(false);
  const [startLocal, setStartLocal] = useState(defaultStartLocal);
  const [matchMinutes, setMatchMinutes] = useState(15);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [minRestMinutes, setMinRestMinutes] = useState(10);
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [teamTab, setTeamTab] = useState<TeamTab>("write");
  const [bulk, setBulk] = useState("");
  // «Hvor mange lag?» — null = tom (ingen lag ennå), ikke et skjult standardtall.
  const [count, setCount] = useState<number | null>(null);
  const [draw, setDraw] = useState(""); // player names for the random draw
  const [tmpls, setTmpls] = useState<Template[]>([]);
  const [focusTeam, setFocusTeam] = useState<number | null>(null);

  const sportRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read saved templates post-mount
    setTmpls(templates.list());
  }, []);

  // A new step starts at the top, with the heading announced to screen readers.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    window.scrollTo({ top: 0 });
    headRef.current?.focus({ preventScroll: true });
  }, [step]);

  // A freshly added team row takes the cursor, so a list can be typed in one go.
  useEffect(() => {
    if (focusTeam === null) return;
    document.getElementById(`w-team-${focusTeam}`)?.focus();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot focus request
    setFocusTeam(null);
  }, [focusTeam, teams.length]);

  function currentTemplateData(): TemplateData {
    return {
      title,
      sport,
      format,
      scoring,
      parallelism,
      courtCount,
      courtNames,
      playoffSize,
      groupCount,
      advancePerGroup,
      thirdPlace,
      grandFinalReset,
      swissRounds,
      tiebreak,
      consolation,
      schedule: {
        on: scheduleOn,
        startTime: timeOfDay(startLocal),
        matchMinutes,
        breakMinutes,
        minRestMinutes,
      },
      teams: validTeams.map((t) => ({
        name: t.name.trim(),
        colour: t.colour,
        members: t.members,
      })),
    };
  }
  function saveTemplate() {
    const name = tmplName?.trim();
    if (!name) return;
    setTmpls(templates.save(name, currentTemplateData()));
    setTmplName(null);
    setTmplSaved(true);
  }
  function loadTemplate(t: Template) {
    const d = t.data;
    setTitle(d.title);
    setSport(d.sport);
    setFormat(d.format);
    setScoring(d.scoring);
    setParallelism(d.parallelism);
    setCourtCount(d.courtCount);
    setCourtNames(d.courtNames);
    setPlayoffSize(d.playoffSize);
    // Older templates predate these three; keep the wizard defaults then.
    if (d.groupCount) setGroupCount(d.groupCount);
    if (d.advancePerGroup) setAdvancePerGroup(d.advancePerGroup);
    setThirdPlace(!!d.thirdPlace);
    setGrandFinalReset(d.grandFinalReset !== false);
    // Added after the first templates: absent = the wizard defaults.
    setSwissRounds(d.swissRounds ?? null);
    setTiebreak(d.tiebreak ?? "standard");
    setConsolation(d.consolation ?? "none");
    if (d.schedule) {
      setScheduleOn(d.schedule.on);
      // Only the time of day is saved; the date stays the wizard's default.
      setStartLocal((cur) => withTimeOfDay(cur, d.schedule!.startTime));
      setMatchMinutes(d.schedule.matchMinutes);
      setBreakMinutes(d.schedule.breakMinutes);
      setMinRestMinutes(d.schedule.minRestMinutes);
    }
    setCount(d.teams.length >= 2 ? Math.min(32, d.teams.length) : null);
    setTeams(
      rollEmblems(
        d.teams.map((tm) => ({
          name: tm.name,
          colour: tm.colour,
          logo_url: null,
          members: tm.members ?? [],
        })),
      ),
    );
  }

  // steps shown — step 6 hosts knockout options (playoff size / groups / bronze)
  const isGroup = format === "group_playoff";
  const isCup = format === "cup";
  const isDouble = format === "double_elim";
  const isSwiss = format === "swiss";
  const minTeams = isDouble || isSwiss ? 3 : 2;
  const showPlayoff = format === "league_playoff" || isGroup;
  // Cup has no league phase but still has a knockout → show step 6 for the
  // bronze-final toggle. Dobbel utslag viser steget for omkamp-valget.
  const showStep6 = showPlayoff || isCup || isDouble;

  function setProfile(p: ScoringProfileKey) {
    setScoring(defaultScoringConfig(p));
  }

  const customSport =
    sport.trim() !== "" && !no.wizard.chips.slice(0, -1).includes(sport as never);
  function pickSport(chip: string) {
    if (chip === "Annet") {
      // «Annet» only hands the field over to the user; it counts as chosen
      // once something of their own stands there.
      if (!customSport) setSport("");
      sportRef.current?.focus();
      return;
    }
    setSport(chip);
    if (chip === "Volleyball") setProfile("sets");
    else if (["Fotball", "Basket", "Innebandy"].includes(chip)) setProfile("simple");
  }

  /** Keep «Hvor mange lag?» in step with the list the user edits by hand. */
  function syncCount(len: number) {
    setCount(len >= 2 ? Math.min(32, len) : null);
  }
  function addTeam() {
    syncCount(teams.length + 1);
    setFocusTeam(teams.length);
    setTeams((t) => [
      ...t,
      { name: "", colour: paletteColour(t.length), logo_url: nextEmblem(t), members: [] },
    ]);
  }
  function removeTeam(i: number) {
    syncCount(teams.length - 1);
    setTeams(teams.filter((_, j) => j !== i));
  }
  /** Random draw: split the pasted name list into balanced teams (gym class).
   * Uses the shared team count, clamped to the number of players. */
  function drawTeams(requested: number) {
    const names = parseNames(draw);
    if (names.length < 2) return;
    const n = Math.max(2, Math.min(requested, names.length));
    // Fisher–Yates shuffle, then deal round-robin for balance.
    const shuffled = [...names];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const buckets: string[][] = Array.from({ length: n }, () => []);
    shuffled.forEach((name, i) => buckets[i % n].push(name));
    const emblems = allEmblemsShuffled();
    setTeams(
      buckets.map((members, i) => ({
        name: `Lag ${i + 1}`,
        colour: paletteColour(i),
        logo_url: emblems[i % emblems.length],
        members,
      })),
    );
    setCount(n);
  }
  /** Set the list to exactly `n` teams: keep names/colours and any uploaded
   * logos; reshuffle a distinct random emblem onto every other team (numbered
   * "Lag X" defaults to rename later). */
  function setTeamCount(n: number) {
    const clamped = Math.max(2, Math.min(32, Math.floor(n) || 0));
    setCount(clamped);
    setTeams((prev) => {
      const list: DraftTeam[] = Array.from({ length: clamped }, (_, i) => ({
        name: prev[i]?.name?.trim() ? prev[i].name : `Lag ${i + 1}`,
        colour: prev[i]?.colour ?? paletteColour(i),
        // drop old emblems so they re-roll; keep uploaded logos
        logo_url: isEmblem(prev[i]?.logo_url) ? null : (prev[i]?.logo_url ?? null),
        members: prev[i]?.members ?? [],
      }));
      return rollEmblems(list);
    });
  }
  function applyBulk() {
    const names = parseNames(bulk);
    syncCount(teams.length + names.length);
    setTeams((t) => {
      const pool = emblemPool(t);
      return [
        ...t,
        ...names.map((name, i) => ({
          name,
          colour: paletteColour(t.length + i),
          logo_url: pool[i] ?? emblemDataUri(Math.floor(Math.random() * EMBLEM_COUNT)),
          members: [],
        })),
      ];
    });
    setBulk("");
  }

  const validTeams = teams.filter((t) => t.name.trim());
  // Derived, so removing teams after picking a size can never leave an
  // invalid choice behind (3 teams at "4 videre" used to mean no playoff).
  const effectivePlayoff = clampPlayoffSize(playoffSize, validTeams.length);
  const effectiveGroups = clampGroupCount(groupCount, validTeams.length);
  const groupsPossible = validTeams.length >= 4;
  // Ekstra sluttspill: bare valg som passer formatet og som det er nok lag til.
  const teamsOutOfA = isGroup
    ? validTeams.length - effectiveGroups * advancePerGroup
    : validTeams.length - effectivePlayoff;
  const consolationChoices = consolationOptions(format).filter((c) =>
    c === "first_round_losers"
      ? cupConsolationFeasible(validTeams.length)
      : c === "b_playoff"
        ? teamsOutOfA >= 2
        : true,
  );
  const swissMax = maxSwissRounds(validTeams.length);
  const effectiveSwissRounds = Math.min(swissRounds ?? defaultSwissRounds(validTeams.length), swissMax);
  const effectiveConsolation = consolationChoices.includes(consolation) ? consolation : "none";

  // Beregnet sluttid (kun med tidsplan): samme kamper og regler som serveren bruker.
  const startIso = scheduleOn ? osloLocalToIso(startLocal) : "";
  const courtsInUse = parallelism === "parallel" ? courtCount : 0;
  const bronze = showStep6 && !isDouble && thirdPlace;
  const extra = showStep6 ? effectiveConsolation : "none";
  // (React Compiler memoises this; it only runs while a schedule is on.)
  const estimate = (() => {
    if (!startIso || validTeams.length < minTeams || (isGroup && !groupsPossible)) return null;
    try {
      return estimateEnd({
        format,
        teamCount: validTeams.length,
        courtCount: courtsInUse,
        schedule: { startAt: startIso, matchMinutes, breakMinutes, minRestMinutes },
        playoffSize: effectivePlayoff,
        groupCount: effectiveGroups,
        advancePerGroup,
        thirdPlace: bronze,
        consolation: extra,
        grandFinalReset,
        swissRounds: effectiveSwissRounds,
      });
    } catch {
      return null; // an estimate must never break the wizard
    }
  })();
  const endLocal = estimate?.endsAt ? isoToOsloLocal(estimate.endsAt) : "";

  const skipped = showStep6 ? [] : [PLAYOFF_STEP];
  function go(n: number, viaSummary = false) {
    setStep(Math.min(Math.max(n, 1), TOTAL));
    setFromSummary(viaSummary);
  }
  function next() {
    if (fromSummary) return go(SUMMARY_STEP);
    let n = step + 1;
    if (n === PLAYOFF_STEP && !showStep6) n++; // skip step 6 (league-only)
    go(n);
  }
  function back() {
    let n = step - 1;
    if (n === PLAYOFF_STEP && !showStep6) n--;
    go(n);
  }

  // Leave the wizard for forsiden; ask first once anything has been entered.
  function cancel() {
    const dirty = step > 1 || title.trim() !== "" || sport.trim() !== "" || teams.length > 0;
    if (dirty && !window.confirm(no.header.cancelConfirm)) return;
    router.push("/");
  }

  async function create() {
    setCreating(true);
    setCreateErr(null);
    try {
      const result = await api.create({
        title: title.trim(),
        sport_label: sport.trim(),
        format,
        scoring,
        parallelism,
        config: {
          playoffSize: showPlayoff && !isGroup ? effectivePlayoff : 0,
          roundRobinDouble: false,
          thirdPlace: showStep6 && !isDouble ? thirdPlace : false,
          ...(isDouble ? { doubleElim: { grandFinalReset } } : {}),
          ...(showStep6 && effectiveConsolation !== "none" ? { consolation: effectiveConsolation } : {}),
          ...(isSwiss ? { swiss: { rounds: effectiveSwissRounds }, tiebreak: tiebreak === "standard" ? "standard" : "swiss" } : {}),
          ...(!isCup && !isDouble && !isSwiss && tiebreak !== "standard" ? { tiebreak } : {}),
          ...(isGroup ? { groupCount: effectiveGroups, advancePerGroup } : {}),
          ...(scheduleOn && startLocal && osloLocalToIso(startLocal) !== ""
            ? {
                schedule: {
                  startAt: osloLocalToIso(startLocal),
                  matchMinutes,
                  breakMinutes,
                  minRestMinutes,
                },
              }
            : {}),
        },
        teams: validTeams.map((t) => ({
          name: t.name.trim(),
          colour: t.colour,
          logo_url: t.logo_url,
          members: t.members,
        })),
        courts:
          parallelism === "parallel"
            ? courtNames.slice(0, courtCount).map((name) => ({ name }))
            : [],
      });
      // Codes go to device storage BEFORE leaving the wizard: the organiser
      // page reads them from there, so Back/reload can never lose them.
      myTournaments.remember({ ...result, title: title.trim() });
      router.replace(`/arrangor/${result.id}`);
    } catch (e) {
      setCreating(false);
      setCreateErr(errorMessage(e));
    }
  }

  const canNext = stepValid(step, { title, validTeams, courtNames, courtCount, parallelism, minTeams });
  const teamsOk = validTeams.length >= minTeams;
  const minMsg = isDouble ? no.wizard.s4MinDouble : no.wizard.s4Min;

  const stepTitles = [
    no.wizard.s1Title, no.wizard.s2Title, no.wizard.s3Title, no.wizard.s4Title,
    no.wizard.s5Title, no.wizard.s6Title, no.wizard.s7Title,
  ];
  const stepLeads = [
    no.wizard.s1Lead, no.wizard.s2Lead, no.wizard.s3Lead, no.wizard.s4Lead,
    no.wizard.s5Lead, no.wizard.s6Lead, no.wizard.s7Lead,
  ];

  return (
    <>
      <SiteHeader>
        <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>
          {no.header.cancel}
        </button>
      </SiteHeader>
      <main className="wiz">
        <h1 className="wiz-title">{no.wizard.title}</h1>
        <Stepper step={step} skipped={skipped} onGo={(n) => go(n)} />

        <div className="card wiz-card">
          <div className="wiz-step">
            <div className="wiz-step-head">
              <h2 ref={headRef} tabIndex={-1}>{stepTitles[step - 1]}</h2>
              <p className="wiz-lead">{stepLeads[step - 1]}</p>
            </div>

            {step === 1 && (
              <>
                {tmpls.length > 0 && (
                  <div className="wiz-sec">
                    <span className="label label-icon">
                      <Icon name="templates" size={18} />
                      {no.wizard.s1Templates}
                    </span>
                    <div className="chips">
                      {tmpls.map((t) => (
                        <span key={t.id} className="chip chip-split">
                          <button type="button" className="chip-btn" onClick={() => loadTemplate(t)}>
                            {t.name}
                          </button>
                          <button
                            type="button"
                            className="chip-btn"
                            aria-label={no.wizard.deleteTemplate(t.name)}
                            title={no.wizard.deleteTemplate(t.name)}
                            onClick={() => setTmpls(templates.remove(t.id))}
                          >
                            <Icon name="close" size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <span className="hint">{no.wizard.s1TemplatesHint}</span>
                  </div>
                )}
                <div className="field">
                  <label className="label" htmlFor="w-title">{no.wizard.s1Name}</label>
                  <input id="w-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={no.wizard.s1NamePlaceholder} autoFocus />
                  <span className="hint">{no.wizard.s1NameHint}</span>
                </div>
                <div className="field">
                  <label className="label" htmlFor="w-sport">{no.wizard.s1Sport}</label>
                  <input id="w-sport" ref={sportRef} className="input" value={sport} onChange={(e) => setSport(e.target.value)} placeholder={no.wizard.s1SportPlaceholder} />
                  <div className="chips" role="group" aria-label={no.wizard.s1Sport}>
                    {no.wizard.chips.map((c) => {
                      const on = c === "Annet" ? customSport : sport === c;
                      return (
                        <button key={c} type="button" className="chip" data-on={on} aria-pressed={on} onClick={() => pickSport(c)}>
                          {c}
                        </button>
                      );
                    })}
                  </div>
                  <span className="hint">{no.wizard.s1SportHint}</span>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="opt-grid opt-grid-2">
                  {FORMATS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className="opt"
                      data-on={format === f}
                      aria-pressed={format === f}
                      onClick={() => {
                        setFormat(f);
                        // Swiss har egen tiebreak-forvalg; bort fra Swiss tilbake til standard.
                        if (f === "swiss") setTiebreak("swiss");
                        else if (tiebreak === "swiss") setTiebreak("standard");
                      }}
                    >
                      <h3>{no.wizard.formats[f].name}</h3>
                      <p>{no.wizard.formats[f].blurb}</p>
                      <span className="opt-practice">
                        {formatPractice(f, validTeams.length, {
                          groupCount,
                          grandFinalReset,
                          swissRounds: effectiveSwissRounds,
                        })}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="wiz-note">
                  <Icon name="idea" size={18} />
                  <div>
                    <strong>{no.wizard.formatHelpTitle}</strong>
                    <ul>
                      {no.wizard.formatHelp.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  </div>
                </div>
                {isSwiss && (
                  <SwissRounds
                    teams={validTeams.length}
                    rounds={effectiveSwissRounds}
                    max={swissMax}
                    onChange={setSwissRounds}
                  />
                )}
              </>
            )}

            {step === 3 && (
              <>
                <div className="opt-grid">
                  {(["simple", "sets", "winner"] as ScoringProfileKey[]).map((p) => (
                    <button key={p} type="button" className="opt" data-on={scoring.profile === p} aria-pressed={scoring.profile === p} onClick={() => setProfile(p)}>
                      <h3>{no.wizard.profiles[p].name}</h3>
                      <p>{no.wizard.profiles[p].blurb}</p>
                    </button>
                  ))}
                </div>
                {scoring.profile === "sets" && (
                  <div className="field">
                    <label className="label" htmlFor="w-bestof">{no.wizard.setsBestOf}</label>
                    <select id="w-bestof" className="select" value={scoring.setsBestOf} onChange={(e) => setScoring({ ...scoring, setsBestOf: Number(e.target.value) })}>
                      {[3, 5, 7].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                )}
                {scoring.profile === "simple" && (
                  <label className="check-row">
                    <input type="checkbox" checked={scoring.allowDraw} onChange={(e) => setScoring({ ...scoring, allowDraw: e.target.checked })} />
                    <span>
                      <span className="check-title">{no.wizard.allowDraw}</span>
                      <span className="hint">{no.wizard.allowDrawHint}</span>
                    </span>
                  </label>
                )}
                <div className="wiz-sec">
                  <div>
                    <div className="wiz-sec-title">{no.wizard.points}</div>
                    <span className="hint">
                      {isCup || isDouble ? no.wizard.pointsNoTable : no.wizard.pointsHint}
                    </span>
                  </div>
                  <div className="wiz-pair">
                    {(["pointsWin", "pointsDraw", "pointsLoss"] as const).map((k) => {
                      const drawOff = k === "pointsDraw" && !(scoring.profile === "simple" && scoring.allowDraw);
                      return (
                        <div className="field" key={k}>
                          <label className="label" htmlFor={`w-${k}`}>{no.wizard.pointsField[k]}</label>
                          <NumberField id={`w-${k}`} min={0} max={100}
                            aria-label={no.wizard.pointsLabel[k]}
                            value={scoring[k]} onChange={(n) => setScoring({ ...scoring, [k]: n })}
                            disabled={drawOff} />
                          {drawOff && (
                            <span className="hint">
                              {scoring.profile === "simple" ? no.wizard.drawOff : no.wizard.drawNone}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {!isCup && !isDouble && (
                  <div className="wiz-sec">
                    <div>
                      <div className="wiz-sec-title">{no.wizard.tiebreak}</div>
                      <span className="hint">{no.wizard.tiebreakLead}</span>
                    </div>
                    <div className="chips" role="group" aria-label={no.wizard.tiebreak}>
                      {((isSwiss ? ["swiss", "standard"] : ["standard", "uefa"]) as TiebreakPreset[]).map((p) => (
                        <button key={p} type="button" className="chip" data-on={tiebreak === p} aria-pressed={tiebreak === p} onClick={() => setTiebreak(p)}>
                          {no.wizard.tiebreakOpts[p]}
                        </button>
                      ))}
                    </div>
                    <span className="hint">{no.wizard.tiebreakHint[tiebreak]}</span>
                  </div>
                )}
              </>
            )}

            {step === 4 && (
              <>
                <div className="wiz-sec">
                  <div className="seg" role="tablist" aria-label={no.wizard.s4TabsLabel}>
                    {(["write", "paste", "draw"] as TeamTab[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        id={`w-tab-${t}`}
                        aria-selected={teamTab === t}
                        aria-controls="w-tabpanel"
                        className="seg-btn"
                        onClick={() => setTeamTab(t)}
                      >
                        {no.wizard.s4Tabs[t]}
                      </button>
                    ))}
                  </div>

                  <div id="w-tabpanel" role="tabpanel" aria-labelledby={`w-tab-${teamTab}`} className="panel wiz-sec">
                    {teamTab === "write" && (
                      <>
                        <div>
                          <div className="wiz-sec-title">{no.wizard.s4QuickTitle}</div>
                          <span className="hint">{no.wizard.s4GenerateHint}</span>
                        </div>
                        <div className="wiz-quick">
                          <div className="field">
                            <label className="label" htmlFor="w-count">{no.wizard.s4HowMany}</label>
                            <NumberField
                              id="w-count"
                              aria-label={no.wizard.s4HowMany}
                              min={2}
                              max={32}
                              value={count}
                              placeholder="–"
                              onChange={setCount}
                              onEnter={setTeamCount}
                            />
                          </div>
                          <button type="button" className="btn btn-gold" disabled={count === null} onClick={() => count !== null && setTeamCount(count)}>
                            {no.wizard.s4Generate(count)}
                          </button>
                        </div>
                        <div className="chips" role="group" aria-label={no.wizard.s4QuickPick}>
                          {QUICK_COUNTS.map((n) => (
                            <button key={n} type="button" className="chip" data-on={teams.length === n} aria-pressed={teams.length === n} onClick={() => setTeamCount(n)}>
                              {n}
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {teamTab === "paste" && (
                      <>
                        <div className="field">
                          <label className="label" htmlFor="w-bulk">{no.wizard.s4Bulk}</label>
                          <textarea id="w-bulk" className="textarea" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"Løvene\nØrnene\nUlvene"} />
                          <span className="hint">{no.wizard.s4BulkHint}</span>
                        </div>
                        <div>
                          <button type="button" className="btn btn-gold" onClick={applyBulk} disabled={parseNames(bulk).length === 0}>
                            <Icon name="paste" />
                            {no.wizard.s4BulkApply}
                          </button>
                        </div>
                      </>
                    )}

                    {teamTab === "draw" && (
                      <DrawPanel
                        draw={draw}
                        setDraw={setDraw}
                        count={count}
                        setCount={setCount}
                        hasTeams={teams.length > 0}
                        onDraw={drawTeams}
                      />
                    )}
                  </div>
                </div>

                <div className="wiz-sec">
                  <h3 className="wiz-sec-title">{no.wizard.s4ListTitle}</h3>
                  <div className="team-count" data-ok={teamsOk} aria-live="polite">
                    <strong>{no.wizard.s4Count(validTeams.length)}</strong>
                    <span className="team-count-msg">{teamsOk ? no.wizard.s4CountOk : minMsg}</span>
                  </div>
                  {teams.length === 0 ? (
                    <div className="team-empty">{no.wizard.s4ListEmpty}</div>
                  ) : (
                    <div className="team-list">
                      <div className="team-head" aria-hidden="true">
                        <span />
                        <span>{no.wizard.s4ColColour}</span>
                        <span>{no.wizard.s4ColName}</span>
                        <span>{no.wizard.s4ColLogo}</span>
                        <span />
                      </div>
                      {teams.map((t, i) => (
                        <div className="team-card" key={i}>
                          <div className="team-row">
                            <span className="team-idx" aria-hidden="true">{i + 1}</span>
                            <input type="color" value={t.colour} onChange={(e) => setTeams(teams.map((x, j) => j === i ? { ...x, colour: e.target.value } : x))}
                              title={no.wizard.s4ColourTitle}
                              aria-label={`Farge, lag ${i + 1}`} />
                            <input id={`w-team-${i}`} className="input" value={t.name} placeholder={no.wizard.s4Name}
                              aria-label={`${no.wizard.s4Name} ${i + 1}`}
                              onChange={(e) => setTeams(teams.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && i === teams.length - 1 && t.name.trim()) {
                                  e.preventDefault();
                                  addTeam();
                                }
                              }} />
                            <LogoUpload
                              url={t.logo_url}
                              onUrl={(u) => setTeams(teams.map((x, j) => j === i ? { ...x, logo_url: u } : x))}
                            />
                            <button type="button" className="btn-icon" aria-label={no.wizard.s4Remove(t.name || String(i + 1))}
                              title={no.wizard.s4Remove(t.name || String(i + 1))}
                              onClick={() => removeTeam(i)}>
                              <Icon name="trash" size={18} />
                            </button>
                          </div>
                          {t.members.length > 0 && (
                            <div className="chips team-members">
                              {t.members.map((m, mi) => (
                                <span className="chip" key={mi} style={{ cursor: "default", minHeight: 32 }}>
                                  {m}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div>
                    <button type="button" className="btn" onClick={addTeam}>
                      <Icon name="more" />
                      {no.wizard.s4Add}
                    </button>
                  </div>
                </div>

                {isSwiss && validTeams.length >= minTeams && (
                  <SwissRounds
                    teams={validTeams.length}
                    rounds={effectiveSwissRounds}
                    max={swissMax}
                    onChange={setSwissRounds}
                  />
                )}
              </>
            )}

            {step === 5 && (
              <>
                <div className="opt-grid opt-grid-2">
                  <button type="button" className="opt" data-on={parallelism === "sequential"} aria-pressed={parallelism === "sequential"} onClick={() => setParallelism("sequential")}>
                    <h3>{no.wizard.sequential}</h3><p>{no.wizard.sequentialBlurb}</p>
                  </button>
                  <button type="button" className="opt" data-on={parallelism === "parallel"} aria-pressed={parallelism === "parallel"} onClick={() => setParallelism("parallel")}>
                    <h3>{no.wizard.parallel}</h3><p>{no.wizard.parallelBlurb}</p>
                  </button>
                </div>
                {parallelism === "parallel" && (
                  <div className="wiz-sec">
                    <div className="field">
                      <label className="label" htmlFor="w-courts">{no.wizard.courtCount}</label>
                      <NumberField id="w-courts" aria-label={no.wizard.courtCount} min={1} max={12} value={courtCount}
                        onChange={(n) => {
                          // Only committed (in-range) values reach here, so the
                          // name list is never resized by a half-typed number.
                          setCourtCount(n);
                          setCourtNames((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? `Bane ${i + 1}`));
                        }} />
                    </div>
                    <div>
                      <div className="label">{no.wizard.courtNames}</div>
                      <span className="hint">{no.wizard.courtNamesHint}</span>
                    </div>
                    <div className="court-grid">
                      {Array.from({ length: courtCount }, (_, i) => (
                        <input key={i} className="input" value={courtNames[i] ?? `Bane ${i + 1}`}
                          aria-label={`${no.wizard.courtName} ${i + 1}`}
                          onChange={(e) => setCourtNames(courtNames.map((c, j) => j === i ? e.target.value : c))} />
                      ))}
                    </div>
                    {!canNext && <div className="wiz-alert" role="alert">{no.wizard.courtNameNeeded}</div>}
                  </div>
                )}
                <div className="divider" />
                <div className="wiz-sec">
                  <label className="check-row">
                    <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
                    <span>
                      <span className="check-title">{no.wizard.scheduleToggle}</span>
                      <span className="hint">{no.wizard.scheduleToggleHint}</span>
                    </span>
                  </label>
                  {scheduleOn && (
                    <>
                      <div className="field">
                        <label className="label" htmlFor="w-start">{no.wizard.scheduleStart}</label>
                        <input id="w-start" className="input" type="datetime-local" value={startLocal}
                          onChange={(e) => setStartLocal(e.target.value)} style={{ maxWidth: 280 }} />
                      </div>
                      <div className="sched-grid">
                        <MinuteField id="w-dur" label={no.wizard.scheduleMatch} hint={no.wizard.scheduleMatchHint} value={matchMinutes} min={1} max={240} onChange={setMatchMinutes} />
                        <MinuteField id="w-brk" label={no.wizard.scheduleBreak} hint={no.wizard.scheduleBreakHint} value={breakMinutes} min={0} max={120} onChange={setBreakMinutes} />
                        <MinuteField id="w-rest" label={no.wizard.scheduleRest} hint={no.wizard.scheduleRestHint} value={minRestMinutes} min={0} max={480} onChange={setMinRestMinutes} />
                      </div>
                      {estimate?.endsAt && (
                        <div className="est-box" aria-live="polite">
                          <span className="est-label">
                            <Icon name="clock" size={16} />
                            {no.wizard.scheduleEnd}
                          </span>
                          <span className="est-time">
                            {timeOfDay(endLocal)}
                            {endLocal.slice(0, 10) !== startLocal.slice(0, 10) && (
                              <small> · {fmtDay(endLocal)}</small>
                            )}
                          </span>
                          <span className="hint">
                            {no.wizard.scheduleEndBasis(estimate.matchCount, courtsInUse)}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}

            {step === 6 && showStep6 && (
              <>
                {isCup || isDouble ? null : isGroup ? (
                  <>
                    <div className="wiz-sec">
                      <div>
                        <div className="label">{no.wizard.groupCount}</div>
                        <span className="hint">{no.wizard.groupCountHint}</span>
                      </div>
                      <div className="chips" role="group" aria-label={no.wizard.groupCount}>
                        {[2, 3, 4].map((n) => (
                          <button
                            key={n}
                            type="button"
                            className="chip"
                            data-on={effectiveGroups === n}
                            aria-pressed={effectiveGroups === n}
                            disabled={n * 2 > validTeams.length}
                            onClick={() => setGroupCount(n)}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="wiz-sec">
                      <div>
                        <div className="label">{no.wizard.advancePerGroup}</div>
                        <span className="hint">{no.wizard.advanceHint}</span>
                      </div>
                      <div className="chips" role="group" aria-label={no.wizard.advancePerGroup}>
                        {[1, 2].map((n) => (
                          <button
                            key={n}
                            type="button"
                            className="chip"
                            data-on={advancePerGroup === n}
                            aria-pressed={advancePerGroup === n}
                            onClick={() => setAdvancePerGroup(n)}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <span className="hint">
                        {groupsPossible
                          ? no.wizard.groupPreview(effectiveGroups, advancePerGroup)
                          : no.wizard.groupNeedsFour}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="wiz-sec">
                    <div className="label">{no.wizard.playoffSize}</div>
                    <div className="chips" role="group" aria-label={no.wizard.playoffSize}>
                      {[2, 4, 8].map((n) => (
                        <button key={n} type="button" className="chip" data-on={effectivePlayoff === n} aria-pressed={effectivePlayoff === n} disabled={n > validTeams.length}
                          onClick={() => setPlayoffSize(n as 2 | 4 | 8)}>{n}</button>
                      ))}
                    </div>
                    <span className="hint">{no.wizard.playoffHint(validTeams.length, effectivePlayoff)}</span>
                  </div>
                )}
                {isDouble ? (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={grandFinalReset}
                      onChange={(e) => setGrandFinalReset(e.target.checked)}
                    />
                    <span>
                      <span className="check-title">{no.wizard.grandFinalReset}</span>
                      <span className="hint">{no.wizard.grandFinalResetHint}</span>
                    </span>
                  </label>
                ) : (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={thirdPlace}
                      onChange={(e) => setThirdPlace(e.target.checked)}
                    />
                    <span>
                      <span className="check-title">{no.wizard.thirdPlace}</span>
                      <span className="hint">{no.wizard.thirdPlaceHint}</span>
                    </span>
                  </label>
                )}
                {consolationChoices.length > 1 && (
                  <div className="wiz-sec">
                    <div className="label">{no.wizard.consolation}</div>
                    <div className="chips" role="group" aria-label={no.wizard.consolation}>
                      {consolationChoices.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className="chip"
                          data-on={effectiveConsolation === c}
                          aria-pressed={effectiveConsolation === c}
                          onClick={() => setConsolation(c)}
                        >
                          {no.wizard.consolationOpts[c]}
                        </button>
                      ))}
                    </div>
                    <span className="hint">{no.wizard.consolationHint[effectiveConsolation]}</span>
                  </div>
                )}
              </>
            )}

            {step === 7 && (
              <>
                <Summary
                  title={title} sport={sport} format={format} scoring={scoring} swissRounds={effectiveSwissRounds}
                  parallelism={parallelism} courtCount={courtCount}
                  teamCount={validTeams.length} playoff={showPlayoff && !isGroup ? effectivePlayoff : 0}
                  groupCount={effectiveGroups} advancePerGroup={advancePerGroup} thirdPlace={thirdPlace}
                  grandFinalReset={isDouble ? grandFinalReset : undefined}
                  consolation={effectiveConsolation}
                  showStep6={showStep6}
                  schedule={scheduleOn ? { startLocal, matchMinutes, breakMinutes, minRestMinutes, endLocal } : null}
                  onEdit={(n) => go(n, true)}
                />
                {!teamsOk && (
                  <div className="wiz-alert" role="alert">{no.wizard.summaryTeamsShort(minMsg)}</div>
                )}
                {isGroup && !groupsPossible && (
                  <div className="wiz-alert" role="alert">{no.wizard.groupNeedsFour}</div>
                )}
                <div className="wiz-sec">
                  {tmplName === null ? (
                    <div className="tmpl-save">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => { setTmplSaved(false); setTmplName(title || sport || "Mal"); }}
                        disabled={validTeams.length < minTeams}
                      >
                        <Icon name="save" />
                        {no.wizard.saveTemplate}
                      </button>
                      {tmplSaved ? (
                        <span className="hint label-icon" role="status">
                          <Icon name="check" size={16} />
                          {no.wizard.saveTemplateDone}
                        </span>
                      ) : (
                        <span className="hint">{no.wizard.saveTemplateHint}</span>
                      )}
                    </div>
                  ) : (
                    <div className="tmpl-save">
                      <label className="sr-only" htmlFor="tmpl-name">{no.wizard.templateName}</label>
                      <input
                        id="tmpl-name"
                        className="input grow"
                        value={tmplName}
                        onChange={(e) => setTmplName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveTemplate()}
                        placeholder={no.wizard.templateName}
                        autoFocus
                      />
                      <button type="button" className="btn btn-gold" onClick={saveTemplate} disabled={!tmplName.trim()}>
                        {no.wizard.saveTemplateDo}
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setTmplName(null)}>
                        {no.common.cancel}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {createErr && <div className="wiz-alert" role="alert">{createErr}</div>}
          </div>

          <div className="wiz-foot">
            <button type="button" className="btn btn-ghost" onClick={back} disabled={step === 1}>
              <Icon name="chevronLeft" size={18} />
              {no.wizard.back}
            </button>
            {step < TOTAL ? (
              <button type="button" className="btn btn-gold" onClick={next} disabled={!canNext}>
                {fromSummary ? no.wizard.backToSummary : no.wizard.next}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-gold btn-lg"
                onClick={create}
                disabled={creating || validTeams.length < minTeams || (isGroup && !groupsPossible)}
              >
                {creating ? <span className="spin" /> : null}
                {creating ? no.wizard.creating : no.wizard.create}
              </button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

/** Clean a pasted multi-line list into names: strips "- [ ]" / "- [x]" task
 * markers, bullets and numbering, trims, drops blanks, de-dupes. */
function parseNames(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const name = raw
      .replace(/^\s*[-*•–—]?\s*\[[ xX]?\]\s*/, "")
      .replace(/^\s*[-*•–—]\s*/, "")
      .replace(/^\s*\d+[.)]\s*/, "")
      .trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// ---- team emblems (distinct, random, no duplicates within a tournament) ----
function emblemPool(teams: DraftTeam[]): string[] {
  const used = new Set(teams.map((t) => t.logo_url).filter(Boolean) as string[]);
  return allEmblemsShuffled().filter((u) => !used.has(u));
}
function nextEmblem(teams: DraftTeam[]): string {
  return emblemPool(teams)[0] ?? emblemDataUri(Math.floor(Math.random() * EMBLEM_COUNT));
}
/** Give every team without a logo a distinct emblem (uploaded logos kept). */
function rollEmblems(list: DraftTeam[]): DraftTeam[] {
  const used = new Set(list.map((t) => t.logo_url).filter(Boolean) as string[]);
  const pool = allEmblemsShuffled().filter((u) => !used.has(u));
  let p = 0;
  return list.map((t) =>
    t.logo_url
      ? t
      : { ...t, logo_url: pool[p++] ?? emblemDataUri(Math.floor(Math.random() * EMBLEM_COUNT)) },
  );
}

function stepValid(
  step: number,
  d: { title: string; validTeams: unknown[]; courtNames: string[]; courtCount: number; parallelism: Parallelism; minTeams: number },
): boolean {
  if (step === 4) return d.validTeams.length >= d.minTeams;
  if (step === 5 && d.parallelism === "parallel")
    return d.courtNames.slice(0, d.courtCount).every((n) => n.trim().length > 0);
  return true;
}

/** How many matches a format plays for `teamCount` teams (a knockout that
 * follows a series isn't counted). */
function matchCountFor(
  format: Format,
  teamCount: number,
  o: { groupCount?: number; grandFinalReset?: boolean; swissRounds?: number },
): number {
  if (format === "cup") return Math.max(0, teamCount - 1);
  // Dobbel utslag: 2N−2 kamper, +1 hvis omkampen spilles (øvre grense vises).
  if (format === "double_elim")
    return Math.max(0, 2 * teamCount - 2) + (o.grandFinalReset ? 1 : 0);
  if (format === "swiss") return (o.swissRounds ?? 0) * Math.floor(teamCount / 2);
  if (format === "group_playoff") {
    const g = o.groupCount ?? 2;
    const base = Math.floor(teamCount / g);
    const rem = teamCount % g;
    let total = 0;
    for (let i = 0; i < g; i++) {
      const size = base + (i < rem ? 1 : 0);
      total += roundRobinMatchCount(size);
    }
    return total;
  }
  return roundRobinMatchCount(teamCount);
}

/** The «what it means» line on a format card: matches for the real team count,
 * or for 8 teams as an example while no teams are entered yet. */
function formatPractice(
  f: Format,
  teamCount: number,
  o: { groupCount: number; grandFinalReset: boolean; swissRounds: number },
): string {
  const known = teamCount >= 3;
  const n = known ? teamCount : 8;
  const groups = clampGroupCount(o.groupCount, n);
  const rounds = known ? o.swissRounds : defaultSwissRounds(n);
  const m = matchCountFor(f, n, { groupCount: groups, grandFinalReset: o.grandFinalReset, swissRounds: rounds });
  const p = no.wizard.formatPractice;
  const text = f === "swiss" ? p.swiss(n, m, rounds) : p[f](n, m);
  return known ? text : `${no.wizard.practiceExample} ${text}`;
}

/** «lør. 24. okt» for a "YYYY-MM-DDTHH:mm" wall-clock value (no time zone maths). */
function fmtDay(local: string): string {
  const d = new Date(`${local.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return local.slice(0, 10);
  return d.toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function SwissRounds({
  teams, rounds, max, onChange,
}: { teams: number; rounds: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="field">
      <label className="label" htmlFor="swiss-rounds">{no.wizard.swissRounds}</label>
      {teams >= 3 ? (
        <NumberField id="swiss-rounds" aria-label={no.wizard.swissRounds} min={1} max={max} value={rounds} onChange={onChange} />
      ) : (
        <span className="hint">{no.wizard.swissRoundsLater}</span>
      )}
      {teams >= 3 && <span className="hint">{no.wizard.swissRoundsHint}</span>}
    </div>
  );
}

function DrawPanel({
  draw, setDraw, count, setCount, hasTeams, onDraw,
}: {
  draw: string;
  setDraw: (s: string) => void;
  count: number | null;
  setCount: (n: number) => void;
  hasTeams: boolean;
  onDraw: (n: number) => void;
}) {
  const names = parseNames(draw);
  // A sensible default (about five per team) shown until the user picks a number.
  const suggested = Math.max(2, Math.min(24, Math.round(names.length / 5)));
  const teamsWanted = Math.min(count ?? suggested, 24);
  return (
    <>
      <div className="field">
        <label className="label" htmlFor="w-draw">{no.wizard.s4DrawNames}</label>
        <textarea id="w-draw" className="textarea" value={draw} onChange={(e) => setDraw(e.target.value)} placeholder={"Ola\nKari\nPer\nNora\n…"} />
        <span className="hint">{no.wizard.s4DrawHint}</span>
      </div>
      <div className="wiz-quick">
        <div className="field">
          <label className="label" htmlFor="w-draw-count">{no.wizard.s4DrawTeams}</label>
          <NumberField id="w-draw-count" min={2} max={24}
            aria-label={no.wizard.s4DrawTeams}
            value={count === null ? null : Math.min(count, 24)}
            placeholder={names.length >= 2 ? String(suggested) : "–"}
            onChange={setCount} />
        </div>
        <button type="button" className="btn btn-gold" onClick={() => onDraw(teamsWanted)}
          disabled={names.length < 2}>
          <Icon name="random" />
          {no.wizard.s4DrawDo}
        </button>
      </div>
      <span className="hint">
        {names.length > 0 ? `${no.wizard.s4DrawSummary(names.length, Math.min(teamsWanted, names.length))} ` : ""}
        {hasTeams ? no.wizard.s4DrawReplaces : ""}
      </span>
    </>
  );
}

function LogoUpload({ url, onUrl }: { url: string | null; onUrl: (u: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <label className="logo-btn" title={err ?? no.wizard.s4LogoTitle}>
      {/* Visually hidden, not display:none — keeps it reachable by keyboard. */}
      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy}
        aria-label="Last opp logo"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          setErr(null);
          try {
            const u = await api.uploadLogo(f);
            onUrl(u);
          } catch (x) {
            setErr(errorMessage(x));
          } finally { setBusy(false); }
        }} />
      {err && (
        <span role="alert" className="logo-err">{err}</span>
      )}
      {busy ? (
        <span className="spin" />
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="team-logo" />
      ) : (
        <Icon name="image" size={20} />
      )}
    </label>
  );
}

/** Neste hele time i Oslo-tid, som "YYYY-MM-DDTHH:mm" (datetime-local). */
function defaultStartLocal(): string {
  return nextOsloHourLocal();
}

function MinuteField({
  id, label, hint, value, min, max, onChange,
}: {
  id: string; label: string; hint: string; value: number; min: number; max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <NumberField id={id} aria-label={label} min={min} max={max} value={value} onChange={onChange} suffix="min" />
      <span className="hint">{hint}</span>
    </div>
  );
}

function Summary(props: {
  title: string; sport: string; format: Format; scoring: ScoringConfig;
  parallelism: Parallelism; courtCount: number; teamCount: number; playoff: number;
  groupCount?: number; advancePerGroup?: number; thirdPlace?: boolean; consolation?: Consolation;
  grandFinalReset?: boolean; swissRounds?: number; showStep6: boolean;
  schedule: {
    startLocal: string; matchMinutes: number; breakMinutes: number; minRestMinutes: number; endLocal: string;
  } | null;
  onEdit: (step: number) => void;
}) {
  const isGroup = props.format === "group_playoff";
  const matchCount = useMemo(
    () =>
      matchCountFor(props.format, props.teamCount, {
        groupCount: props.groupCount,
        grandFinalReset: props.grandFinalReset,
        swissRounds: props.swissRounds,
      }),
    [props.format, props.teamCount, props.groupCount, props.grandFinalReset, props.swissRounds],
  );
  const rounds = props.format === "swiss" ? props.swissRounds : props.format === "cup" || props.format === "double_elim" || isGroup ? null : roundRobinRoundCount(props.teamCount);

  const sc = props.scoring;
  const pointsLine =
    sc.profile === "simple" && sc.allowDraw
      ? `${no.wizard.pointsField.pointsWin} ${sc.pointsWin} · ${no.wizard.pointsField.pointsDraw} ${sc.pointsDraw} · ${no.wizard.pointsField.pointsLoss} ${sc.pointsLoss}`
      : `${no.wizard.pointsField.pointsWin} ${sc.pointsWin} · ${no.wizard.pointsField.pointsLoss} ${sc.pointsLoss}`;

  // [label, value, small line under the value, step to jump to («Endre»)]
  const rows: [string, string, string | undefined, number | null][] = [
    [no.wizard.s1Name, props.title || "—", undefined, 1],
    [no.wizard.s1Sport, props.sport || "—", undefined, 1],
    [no.wizard.summaryFormat, no.wizard.formats[props.format].name, undefined, 2],
    [no.wizard.summaryScoring, no.wizard.profiles[props.scoring.profile].name, pointsLine, 3],
    [no.wizard.summaryTeams, String(props.teamCount), undefined, 4],
    [no.wizard.summaryCourts, props.parallelism === "parallel" ? String(props.courtCount) : no.wizard.sequential, undefined, 5],
  ];
  if (props.schedule) {
    const s = props.schedule;
    rows.push([
      no.wizard.summarySchedule,
      `${fmtDay(s.startLocal)} kl. ${timeOfDay(s.startLocal)}`,
      no.wizard.summaryScheduleLine(s.matchMinutes, s.breakMinutes, s.minRestMinutes),
      5,
    ]);
    if (s.endLocal)
      rows.push([
        no.wizard.summaryEnd,
        `kl. ${timeOfDay(s.endLocal)}${s.endLocal.slice(0, 10) !== s.startLocal.slice(0, 10) ? ` · ${fmtDay(s.endLocal)}` : ""}`,
        undefined,
        null,
      ]);
  } else {
    rows.push([no.wizard.summarySchedule, no.wizard.summaryScheduleOff, undefined, 5]);
  }
  rows.push([no.wizard.summaryMatches, `${matchCount}${rounds ? ` · ${no.wizard.summaryRounds(rounds)}` : ""}`, undefined, null]);
  if (props.format === "swiss") rows.push([no.wizard.swissRounds, String(props.swissRounds ?? ""), undefined, 4]);
  if (isGroup)
    rows.push([
      no.wizard.formats.group_playoff.name,
      no.wizard.groupPreview(props.groupCount ?? 2, props.advancePerGroup ?? 2),
      undefined,
      6,
    ]);
  else if (props.playoff) rows.push([no.wizard.s6Title, `${props.playoff} lag`, undefined, 6]);
  if (props.thirdPlace) rows.push([no.wizard.thirdPlace, no.wizard.summaryYes, undefined, 6]);
  if (props.grandFinalReset) rows.push([no.wizard.grandFinalReset, no.wizard.summaryYes, undefined, 6]);
  if (props.consolation && props.consolation !== "none")
    rows.push([no.wizard.consolation, no.wizard.consolationOpts[props.consolation], undefined, 6]);

  return (
    <div className="sum">
      {rows.map(([k, v, small, step]) => (
        <div className="sum-row" key={k}>
          <span className="sum-k">{k}</span>
          <span className="sum-v">
            {v}
            {small && <small>{small}</small>}
          </span>
          {step !== null && (
            <button type="button" className="sum-edit" aria-label={`${no.wizard.change}: ${k}`} onClick={() => props.onEdit(step)}>
              <Icon name="edit" size={14} />
              {no.wizard.change}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
