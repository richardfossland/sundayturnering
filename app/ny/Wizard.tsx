"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import { paletteColour } from "@/lib/palette";
import { nextOsloHourLocal, osloLocalToIso } from "@/lib/tournament/osloTime";
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

interface DraftTeam {
  name: string;
  colour: string;
  logo_url: string | null;
  members: string[];
}

const TOTAL = 7;

export function Wizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [tmplName, setTmplName] = useState<string | null>(null); // null = closed

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
  const [bulk, setBulk] = useState("");
  const [count, setCount] = useState(8);
  const [draw, setDraw] = useState(""); // player names for the random draw
  const [tmpls, setTmpls] = useState<Template[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read saved templates post-mount
    setTmpls(templates.list());
  }, []);

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
    setCount(d.teams.length || 8);
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

  function pickSport(chip: string) {
    setSport(chip === "Annet" ? "" : chip);
    if (chip === "Volleyball") setProfile("sets");
    else if (["Fotball", "Basket", "Innebandy"].includes(chip)) setProfile("simple");
  }

  function addTeam() {
    setTeams((t) => [
      ...t,
      { name: "", colour: paletteColour(t.length), logo_url: nextEmblem(t), members: [] },
    ]);
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

  function next() {
    let n = step + 1;
    if (n === 6 && !showStep6) n = 7; // skip step 6 (league-only)
    setStep(Math.min(n, TOTAL));
  }
  function back() {
    let n = step - 1;
    if (n === 6 && !showStep6) n = 5;
    setStep(Math.max(n, 1));
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

  return (
    <main className="center-screen">
      <div className="card card-pad stack" style={{ maxWidth: 560, width: "100%" }}>
        <div className="spread">
          <span className="brand" style={{ fontSize: ".95rem" }}>
            <span className="brand-mark" style={{ width: 26, height: 26, fontSize: ".8rem" }}>T</span>
            {no.wizard.title}
          </span>
          <span className="faint" style={{ fontSize: ".82rem" }}>
            {no.wizard.step(stepNumberLabel(step, showStep6), showStep6 ? 7 : 6)}
          </span>
        </div>

        <Progress step={step} showPlayoff={showStep6} />

        <div className="stack" style={{ minHeight: 260 }}>
          {step === 1 && (
            <Step title={no.wizard.s1Title}>
              {tmpls.length > 0 && (
                <div className="panel stack" style={{ gap: 8 }}>
                  <span className="label">📁 Maler</span>
                  <div className="chips">
                    {tmpls.map((t) => (
                      <span key={t.id} className="chip" style={{ padding: 0, display: "inline-flex" }}>
                        <button
                          type="button"
                          className="chip-btn"
                          onClick={() => loadTemplate(t)}
                        >
                          {t.name}
                        </button>
                        <button
                          type="button"
                          className="chip-btn"
                          aria-label={`Slett mal ${t.name}`}
                          onClick={() => setTmpls(templates.remove(t.id))}
                          style={{ opacity: 0.6, paddingLeft: 0 }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="field">
                <label className="label" htmlFor="w-title">{no.wizard.s1Name}</label>
                <input id="w-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={no.wizard.s1NamePlaceholder} autoFocus />
              </div>
              <div className="field">
                <label className="label" htmlFor="w-sport">{no.wizard.s1Sport}</label>
                <input id="w-sport" className="input" value={sport} onChange={(e) => setSport(e.target.value)} placeholder={no.wizard.s1SportPlaceholder} />
              </div>
              <div className="chips">
                {no.wizard.chips.map((c) => (
                  <button key={c} className="chip" data-on={sport === c || (c === "Annet" && !no.wizard.chips.includes(sport as never))} onClick={() => pickSport(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </Step>
          )}

          {step === 2 && (
            <Step title={no.wizard.s2Title}>
              <div className="opt-grid">
                {(["league", "league_playoff", "group_playoff", "cup", "double_elim", "swiss"] as Format[]).map((f) => (
                  <button
                    key={f}
                    className="opt"
                    data-on={format === f}
                    onClick={() => {
                      setFormat(f);
                      // Swiss har egen tiebreak-forvalg; bort fra Swiss tilbake til standard.
                      if (f === "swiss") setTiebreak("swiss");
                      else if (tiebreak === "swiss") setTiebreak("standard");
                    }}
                  >
                    <h3>{no.wizard.formats[f].name}</h3>
                    <p>{no.wizard.formats[f].blurb}</p>
                  </button>
                ))}
              </div>
              {isSwiss && (
                <div className="field">
                  <label className="label" htmlFor="swiss-rounds">{no.wizard.swissRounds}</label>
                  <select
                    id="swiss-rounds"
                    className="input"
                    value={effectiveSwissRounds}
                    onChange={(e) => setSwissRounds(Number(e.target.value))}
                  >
                    {Array.from({ length: swissMax }, (_, i) => i + 1).map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <span className="faint">{no.wizard.swissRoundsHint}</span>
                </div>
              )}
            </Step>
          )}

          {step === 3 && (
            <Step title={no.wizard.s3Title}>
              <div className="opt-grid">
                {(["simple", "sets", "winner"] as ScoringProfileKey[]).map((p) => (
                  <button key={p} className="opt" data-on={scoring.profile === p} onClick={() => setProfile(p)}>
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
                <label className="row" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={scoring.allowDraw} onChange={(e) => setScoring({ ...scoring, allowDraw: e.target.checked })} />
                  <span>{no.wizard.allowDraw}</span>
                </label>
              )}
              <div className="field">
                <label className="label">{no.wizard.points}</label>
                <div className="row">
                  {(["pointsWin", "pointsDraw", "pointsLoss"] as const).map((k) => (
                    <input key={k} className="input" type="number" min={0} max={100} style={{ width: 80 }}
                      aria-label={no.wizard.pointsLabel[k]}
                      value={scoring[k]} onChange={(e) => setScoring({ ...scoring, [k]: Number(e.target.value) })}
                      disabled={k === "pointsDraw" && !(scoring.profile === "simple" && scoring.allowDraw)} />
                  ))}
                </div>
              </div>
              {!isCup && !isDouble && (
                <div className="field">
                  <label className="label">{no.wizard.tiebreak}</label>
                  <div className="chips">
                    {((isSwiss ? ["swiss", "standard"] : ["standard", "uefa"]) as TiebreakPreset[]).map((p) => (
                      <button key={p} className="chip" data-on={tiebreak === p} onClick={() => setTiebreak(p)}>
                        {no.wizard.tiebreakOpts[p]}
                      </button>
                    ))}
                  </div>
                  <span className="faint">{no.wizard.tiebreakHint[tiebreak]}</span>
                </div>
              )}
            </Step>
          )}

          {step === 4 && (
            <Step title={no.wizard.s4Title}>
              <div className="panel stack" style={{ gap: 10 }}>
                <label className="label" htmlFor="w-count">{no.wizard.s4HowMany}</label>
                <div className="row">
                  <input
                    id="w-count"
                    className="input"
                    type="number"
                    min={2}
                    max={32}
                    inputMode="numeric"
                    style={{ width: 96 }}
                    value={count}
                    onChange={(e) => setCount(Math.max(0, Number(e.target.value) || 0))}
                    onKeyDown={(e) => e.key === "Enter" && setTeamCount(count)}
                  />
                  <button className="btn btn-gold" onClick={() => setTeamCount(count)}>
                    {no.wizard.s4Generate}
                  </button>
                </div>
                <div className="chips">
                  {[4, 6, 8, 10, 12, 16].map((n) => (
                    <button key={n} className="chip" onClick={() => setTeamCount(n)}>
                      {n}
                    </button>
                  ))}
                </div>
                <span className="faint" style={{ fontSize: ".82rem" }}>
                  {no.wizard.s4GenerateHint}
                </span>
              </div>
              <div className="stack" style={{ gap: 8, maxHeight: 320, overflow: "auto" }}>
                {teams.map((t, i) => (
                  <div className="panel" key={i} style={{ padding: 10 }}>
                    <div className="row">
                      <input type="color" value={t.colour} onChange={(e) => setTeams(teams.map((x, j) => j === i ? { ...x, colour: e.target.value } : x))}
                        style={{ width: 42, height: 42, border: "none", borderRadius: 10, background: "none" }}
                        aria-label={`Farge, lag ${i + 1}`} />
                      <input className="input grow" value={t.name} placeholder={no.wizard.s4Name}
                        aria-label={`${no.wizard.s4Name} ${i + 1}`}
                        onChange={(e) => setTeams(teams.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                      <LogoUpload
                        url={t.logo_url}
                        onUrl={(u) => setTeams(teams.map((x, j) => j === i ? { ...x, logo_url: u } : x))}
                      />
                      <button className="btn btn-ghost" aria-label={`Fjern lag ${t.name || i + 1}`}
                        onClick={() => setTeams(teams.filter((_, j) => j !== i))}>✕</button>
                    </div>
                    {t.members.length > 0 && (
                      <div className="chips" style={{ marginTop: 8 }}>
                        {t.members.map((m, mi) => (
                          <span className="chip" key={mi} style={{ fontSize: ".78rem", cursor: "default" }}>
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button className="btn btn-ghost btn-block" onClick={addTeam}>+ {no.wizard.s4Add}</button>
              <details>
                <summary className="muted" style={{ cursor: "pointer", fontSize: ".9rem" }}>{no.wizard.s4Draw}</summary>
                <div className="stack" style={{ marginTop: 8 }}>
                  <textarea className="textarea" value={draw} onChange={(e) => setDraw(e.target.value)} placeholder={"Ola\nKari\nPer\nNora\n…"} />
                  <div className="row">
                    <span className="label">{no.wizard.s4DrawTeams}</span>
                    <input className="input" type="number" min={2} max={24} style={{ width: 80 }}
                      value={count}
                      onChange={(e) => setCount(Math.max(2, Math.min(24, Number(e.target.value) || 2)))} />
                    <button className="btn btn-gold grow" onClick={() => drawTeams(count)}
                      disabled={parseNames(draw).length < 2}>
                      🎲 {no.wizard.s4DrawDo}
                    </button>
                  </div>
                  <span className="faint" style={{ fontSize: ".82rem" }}>
                    {parseNames(draw).length > 0
                      ? `${parseNames(draw).length} deltakere → ${Math.min(count, parseNames(draw).length)} lag. `
                      : ""}
                    {no.wizard.s4DrawHint}
                  </span>
                </div>
              </details>
              <details>
                <summary className="muted" style={{ cursor: "pointer", fontSize: ".9rem" }}>{no.wizard.s4Bulk}</summary>
                <div className="stack" style={{ marginTop: 8 }}>
                  <textarea className="textarea" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"Løvene\nØrnene\nUlvene"} />
                  <button className="btn" onClick={applyBulk} disabled={!bulk.trim()}>{no.wizard.s4BulkApply}</button>
                </div>
              </details>
              <div className="faint">{no.wizard.s4Count(validTeams.length)}{validTeams.length < minTeams ? ` — ${isDouble ? no.wizard.s4MinDouble : no.wizard.s4Min}` : ""}</div>
            </Step>
          )}

          {step === 5 && (
            <Step title={no.wizard.s5Title}>
              <div className="opt-grid">
                <button className="opt" data-on={parallelism === "sequential"} onClick={() => setParallelism("sequential")}>
                  <h3>{no.wizard.sequential}</h3><p>{no.wizard.sequentialBlurb}</p>
                </button>
                <button className="opt" data-on={parallelism === "parallel"} onClick={() => setParallelism("parallel")}>
                  <h3>{no.wizard.parallel}</h3><p>{no.wizard.parallelBlurb}</p>
                </button>
              </div>
              {parallelism === "parallel" && (
                <>
                  <div className="field">
                    <label className="label" htmlFor="w-courts">{no.wizard.courtCount}</label>
                    <input id="w-courts" className="input" type="number" min={1} max={12} value={courtCount} style={{ width: 100 }}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(12, Number(e.target.value) || 1));
                        setCourtCount(n);
                        setCourtNames((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? `Bane ${i + 1}`));
                      }} />
                  </div>
                  <div className="stack" style={{ gap: 8 }}>
                    {Array.from({ length: courtCount }, (_, i) => (
                      <input key={i} className="input" value={courtNames[i] ?? `Bane ${i + 1}`}
                        aria-label={`${no.wizard.courtName} ${i + 1}`}
                        onChange={(e) => setCourtNames(courtNames.map((c, j) => j === i ? e.target.value : c))} />
                    ))}
                  </div>
                </>
              )}
              <div className="divider" />
              <label className="row" style={{ gap: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
                <span>{no.wizard.scheduleToggle}</span>
              </label>
              {scheduleOn && (
                <div className="stack" style={{ gap: 10 }}>
                  <p className="muted">{no.wizard.scheduleBlurb}</p>
                  <div className="field">
                    <label className="label" htmlFor="w-start">{no.wizard.scheduleStart}</label>
                    <input id="w-start" className="input" type="datetime-local" value={startLocal}
                      onChange={(e) => setStartLocal(e.target.value)} />
                  </div>
                  <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                    <MinuteField id="w-dur" label={no.wizard.scheduleMatch} value={matchMinutes} min={1} max={240} onChange={setMatchMinutes} />
                    <MinuteField id="w-brk" label={no.wizard.scheduleBreak} value={breakMinutes} min={0} max={120} onChange={setBreakMinutes} />
                    <MinuteField id="w-rest" label={no.wizard.scheduleRest} value={minRestMinutes} min={0} max={480} onChange={setMinRestMinutes} />
                  </div>
                </div>
              )}
            </Step>
          )}

          {step === 6 && showStep6 && (
            <Step title={no.wizard.s6Title}>
              {isCup || isDouble ? null : isGroup ? (
                <>
                  <div className="field">
                    <label className="label">{no.wizard.groupCount}</label>
                    <div className="chips">
                      {[2, 3, 4].map((n) => (
                        <button
                          key={n}
                          className="chip"
                          data-on={effectiveGroups === n}
                          disabled={n * 2 > validTeams.length}
                          onClick={() => setGroupCount(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <label className="label">{no.wizard.advancePerGroup}</label>
                    <div className="chips">
                      {[1, 2].map((n) => (
                        <button
                          key={n}
                          className="chip"
                          data-on={advancePerGroup === n}
                          onClick={() => setAdvancePerGroup(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <span className="faint">
                      {groupsPossible
                        ? no.wizard.groupPreview(effectiveGroups, advancePerGroup)
                        : no.wizard.groupNeedsFour}
                    </span>
                  </div>
                </>
              ) : (
                <div className="field">
                  <label className="label">{no.wizard.playoffSize}</label>
                  <div className="chips">
                    {[2, 4, 8].map((n) => (
                      <button key={n} className="chip" data-on={effectivePlayoff === n} disabled={n > validTeams.length}
                        onClick={() => setPlayoffSize(n as 2 | 4 | 8)}>{n}</button>
                    ))}
                  </div>
                  <span className="faint">{no.wizard.playoffCapped(validTeams.length)} · {effectivePlayoff} går videre</span>
                </div>
              )}
              {isDouble ? (
                <div className="field">
                  <label className="row" style={{ gap: 10, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={grandFinalReset}
                      onChange={(e) => setGrandFinalReset(e.target.checked)}
                    />
                    <span>{no.wizard.grandFinalReset}</span>
                  </label>
                  <span className="faint">{no.wizard.grandFinalResetHint}</span>
                </div>
              ) : (
                <label className="row" style={{ gap: 10, cursor: "pointer", marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={thirdPlace}
                    onChange={(e) => setThirdPlace(e.target.checked)}
                  />
                  <span>{no.wizard.thirdPlace}</span>
                </label>
              )}
              {consolationChoices.length > 1 && (
                <div className="field" style={{ marginTop: 8 }}>
                  <label className="label">{no.wizard.consolation}</label>
                  <div className="chips">
                    {consolationChoices.map((c) => (
                      <button
                        key={c}
                        className="chip"
                        data-on={effectiveConsolation === c}
                        onClick={() => setConsolation(c)}
                      >
                        {no.wizard.consolationOpts[c]}
                      </button>
                    ))}
                  </div>
                  <span className="faint">{no.wizard.consolationHint[effectiveConsolation]}</span>
                </div>
              )}
            </Step>
          )}

          {step === 7 && (
            <Step title={no.wizard.s7Title}>
              <Summary
                title={title} sport={sport} format={format} scoring={scoring} swissRounds={effectiveSwissRounds}
                parallelism={parallelism} courtCount={courtCount}
                teamCount={validTeams.length} playoff={showPlayoff && !isGroup ? effectivePlayoff : 0}
                groupCount={effectiveGroups} advancePerGroup={advancePerGroup} thirdPlace={thirdPlace}
                grandFinalReset={isDouble ? grandFinalReset : undefined}
                consolation={effectiveConsolation}
              />
              {tmplName === null ? (
                <button
                  className="btn btn-block"
                  onClick={() => setTmplName(title || sport || "Mal")}
                  disabled={validTeams.length < minTeams}
                >
                  💾 {no.wizard.saveTemplate}
                </button>
              ) : (
                <div className="row">
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
                  <button className="btn btn-gold" onClick={saveTemplate} disabled={!tmplName.trim()}>
                    {no.wizard.saveTemplateDo}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setTmplName(null)}>
                    {no.common.cancel}
                  </button>
                </div>
              )}
              {isGroup && !groupsPossible && (
                <div className="toast-danger" role="alert">{no.wizard.groupNeedsFour}</div>
              )}
            </Step>
          )}
        </div>

        {createErr && (
          <div className="toast-danger" role="alert" style={{ fontSize: ".9rem" }}>
            {createErr}
          </div>
        )}
        <div className="spread">
          <button className="btn btn-ghost" onClick={back} disabled={step === 1}>{no.wizard.back}</button>
          {step < TOTAL ? (
            <button className="btn btn-gold" onClick={next} disabled={!canNext}>{no.wizard.next}</button>
          ) : (
            <button
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

function stepNumberLabel(step: number, showPlayoff: boolean): number {
  if (!showPlayoff && step === 7) return 6;
  return step;
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

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="stack">
      <h2 style={{ fontSize: "1.4rem" }}>{title}</h2>
      {children}
    </div>
  );
}

function Progress({ step, showPlayoff }: { step: number; showPlayoff: boolean }) {
  const total = showPlayoff ? 7 : 6;
  const current = stepNumberLabel(step, showPlayoff);
  return (
    <div className="row" style={{ gap: 6 }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{
          height: 4, flex: 1, borderRadius: 2,
          background: i < current ? "var(--gold)" : "var(--ink-line-strong)",
          transition: "background .2s",
        }} />
      ))}
    </div>
  );
}

function LogoUpload({ url, onUrl }: { url: string | null; onUrl: (u: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <label style={{ cursor: "pointer", position: "relative" }} title={err ?? "Logo"}>
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
        <span className="spin" style={{ display: "inline-block" }} />
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="team-logo" />
      ) : (
        <span className="btn btn-ghost" style={{ padding: "10px 12px" }}>🖼</span>
      )}
    </label>
  );
}

/** Neste hele time i Oslo-tid, som "YYYY-MM-DDTHH:mm" (datetime-local). */
function defaultStartLocal(): string {
  return nextOsloHourLocal();
}

function MinuteField({
  id, label, value, min, max, onChange,
}: {
  id: string; label: string; value: number; min: number; max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" type="number" min={min} max={max} value={value} style={{ width: 100 }}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Math.floor(Number(e.target.value)) || min)))} />
    </div>
  );
}

function Summary(props: {
  title: string; sport: string; format: Format; scoring: ScoringConfig;
  parallelism: Parallelism; courtCount: number; teamCount: number; playoff: number;
  groupCount?: number; advancePerGroup?: number; thirdPlace?: boolean; consolation?: Consolation;
  grandFinalReset?: boolean; swissRounds?: number;
}) {
  const isGroup = props.format === "group_playoff";
  const matchCount = useMemo(() => {
    if (props.format === "cup") return Math.max(0, props.teamCount - 1);
    // Dobbel utslag: 2N−2 kamper, +1 hvis omkampen spilles (øvre grense vises).
    if (props.format === "double_elim")
      return Math.max(0, 2 * props.teamCount - 2) + (props.grandFinalReset ? 1 : 0);
    if (props.format === "swiss") return (props.swissRounds ?? 0) * Math.floor(props.teamCount / 2);
    if (isGroup) {
      const g = props.groupCount ?? 2;
      const base = Math.floor(props.teamCount / g);
      const rem = props.teamCount % g;
      let total = 0;
      for (let i = 0; i < g; i++) {
        const size = base + (i < rem ? 1 : 0);
        total += roundRobinMatchCount(size);
      }
      return total;
    }
    return roundRobinMatchCount(props.teamCount);
  }, [props.format, props.teamCount, isGroup, props.groupCount, props.grandFinalReset, props.swissRounds]);
  const rounds = props.format === "swiss" ? props.swissRounds : props.format === "cup" || props.format === "double_elim" || isGroup ? null : roundRobinRoundCount(props.teamCount);

  const rows: [string, string][] = [
    [no.wizard.s1Name, props.title || "—"],
    [no.wizard.s1Sport, props.sport || "—"],
    [no.wizard.summaryFormat, no.wizard.formats[props.format].name],
    [no.wizard.summaryScoring, no.wizard.profiles[props.scoring.profile].name],
    [no.wizard.summaryTeams, String(props.teamCount)],
    [no.wizard.summaryCourts, props.parallelism === "parallel" ? String(props.courtCount) : no.wizard.sequential],
    ["Kamper", `${matchCount}${rounds ? ` · ${rounds} runder` : ""}`],
  ];
  if (isGroup)
    rows.push([
      no.wizard.formats.group_playoff.name,
      no.wizard.groupPreview(props.groupCount ?? 2, props.advancePerGroup ?? 2),
    ]);
  else if (props.playoff) rows.push([no.wizard.s6Title, `${props.playoff} lag`]);
  if (props.thirdPlace) rows.push([no.wizard.thirdPlace, "Ja"]);
  if (props.grandFinalReset) rows.push([no.wizard.grandFinalReset, "Ja"]);
  if (props.consolation && props.consolation !== "none")
    rows.push([no.wizard.consolation, no.wizard.consolationOpts[props.consolation]]);

  return (
    <div className="panel stack" style={{ gap: 10 }}>
      {rows.map(([k, v]) => (
        <div className="spread" key={k}>
          <span className="muted">{k}</span>
          <span style={{ fontWeight: 700 }}>{v}</span>
        </div>
      ))}
      <div className="divider" />
      <div className="faint center">{no.wizard.summaryCreate}</div>
    </div>
  );
}
