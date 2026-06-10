"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import { paletteColour } from "@/lib/palette";
import {
  allEmblemsShuffled,
  emblemDataUri,
  isEmblem,
  EMBLEM_COUNT,
} from "@/lib/emblems";
import {
  templates,
  type Template,
  type TemplateData,
} from "@/lib/client/templates";
import { defaultScoringConfig } from "@/lib/tournament/scoring";
import {
  roundRobinMatchCount,
  roundRobinRoundCount,
} from "@/lib/tournament/roundRobin";
import type {
  Format,
  Parallelism,
  ScoringConfig,
  ScoringProfileKey,
} from "@/lib/types";
import { Created } from "./Created";

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
  const [created, setCreated] = useState<{
    id: string;
    control_code: string;
    board_code: string;
    organiser_code: string;
  } | null>(null);

  // draft
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState("");
  const [format, setFormat] = useState<Format>("league");
  const [scoring, setScoring] = useState<ScoringConfig>(defaultScoringConfig("simple"));
  const [parallelism, setParallelism] = useState<Parallelism>("sequential");
  const [courtCount, setCourtCount] = useState(2);
  const [courtNames, setCourtNames] = useState<string[]>(["Bane 1", "Bane 2"]);
  const [playoffSize, setPlayoffSize] = useState<2 | 4 | 8>(4);
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
      teams: validTeams.map((t) => ({
        name: t.name.trim(),
        colour: t.colour,
        members: t.members,
      })),
    };
  }
  function saveTemplate() {
    const name = window.prompt("Navn på mal", title || sport || "Mal");
    if (!name?.trim()) return;
    setTmpls(templates.save(name.trim(), currentTemplateData()));
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

  // steps shown — skip step 6 unless league_playoff
  const showPlayoff = format === "league_playoff";

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
  const maxPlayoff = Math.min(playoffSize, validTeams.length);

  function next() {
    let n = step + 1;
    if (n === 6 && !showPlayoff) n = 7; // skip playoff step
    setStep(Math.min(n, TOTAL));
  }
  function back() {
    let n = step - 1;
    if (n === 6 && !showPlayoff) n = 5;
    setStep(Math.max(n, 1));
  }

  async function create() {
    setCreating(true);
    try {
      const result = await api.create({
        title: title.trim(),
        sport_label: sport.trim(),
        format,
        scoring,
        parallelism,
        config: {
          playoffSize: showPlayoff ? (Math.min(playoffSize, validTeams.length) as 2 | 4 | 8) : 0,
          roundRobinDouble: false,
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
      setCreated(result);
    } catch {
      setCreating(false);
      alert(no.common.error);
    }
  }

  if (created) return <Created result={created} onBoard={() => router.push(`/board/${created.id}`)} />;

  const canNext = stepValid(step, { title, validTeams, courtNames, courtCount, parallelism });

  return (
    <main className="center-screen">
      <div className="card card-pad stack" style={{ maxWidth: 560, width: "100%" }}>
        <div className="spread">
          <span className="brand" style={{ fontSize: ".95rem" }}>
            <span className="brand-mark" style={{ width: 26, height: 26, fontSize: ".8rem" }}>T</span>
            {no.wizard.title}
          </span>
          <span className="faint" style={{ fontSize: ".82rem" }}>
            {no.wizard.step(stepNumberLabel(step, showPlayoff), showPlayoff ? 7 : 6)}
          </span>
        </div>

        <Progress step={step} showPlayoff={showPlayoff} />

        <div className="stack" style={{ minHeight: 260 }}>
          {step === 1 && (
            <Step title={no.wizard.s1Title}>
              {tmpls.length > 0 && (
                <div className="panel stack" style={{ gap: 8 }}>
                  <span className="label">📁 Maler</span>
                  <div className="chips">
                    {tmpls.map((t) => (
                      <span key={t.id} className="chip" style={{ cursor: "pointer" }} onClick={() => loadTemplate(t)}>
                        {t.name}
                        <span
                          role="button"
                          aria-label="Slett mal"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTmpls(templates.remove(t.id));
                          }}
                          style={{ marginLeft: 8, opacity: 0.6 }}
                        >
                          ✕
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="field">
                <label className="label">{no.wizard.s1Name}</label>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={no.wizard.s1NamePlaceholder} autoFocus />
              </div>
              <div className="field">
                <label className="label">{no.wizard.s1Sport}</label>
                <input className="input" value={sport} onChange={(e) => setSport(e.target.value)} placeholder={no.wizard.s1SportPlaceholder} />
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
                {(["league", "league_playoff", "cup"] as Format[]).map((f) => (
                  <button key={f} className="opt" data-on={format === f} onClick={() => setFormat(f)}>
                    <h3>{no.wizard.formats[f].name}</h3>
                    <p>{no.wizard.formats[f].blurb}</p>
                  </button>
                ))}
              </div>
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
                  <label className="label">{no.wizard.setsBestOf}</label>
                  <select className="select" value={scoring.setsBestOf} onChange={(e) => setScoring({ ...scoring, setsBestOf: Number(e.target.value) })}>
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
                    <input key={k} className="input" type="number" min={0} style={{ width: 80 }}
                      value={scoring[k]} onChange={(e) => setScoring({ ...scoring, [k]: Number(e.target.value) })}
                      disabled={k === "pointsDraw" && !(scoring.profile === "simple" && scoring.allowDraw)} />
                  ))}
                </div>
              </div>
            </Step>
          )}

          {step === 4 && (
            <Step title={no.wizard.s4Title}>
              <div className="panel stack" style={{ gap: 10 }}>
                <label className="label">{no.wizard.s4HowMany}</label>
                <div className="row">
                  <input
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
                        style={{ width: 42, height: 42, border: "none", borderRadius: 10, background: "none" }} aria-label="farge" />
                      <input className="input grow" value={t.name} placeholder={no.wizard.s4Name}
                        onChange={(e) => setTeams(teams.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                      <LogoUpload
                        url={t.logo_url}
                        onUrl={(u) => setTeams(teams.map((x, j) => j === i ? { ...x, logo_url: u } : x))}
                      />
                      <button className="btn btn-ghost" onClick={() => setTeams(teams.filter((_, j) => j !== i))}>✕</button>
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
              <div className="faint">{no.wizard.s4Count(validTeams.length)}{validTeams.length < 2 ? ` — ${no.wizard.s4Min}` : ""}</div>
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
                    <label className="label">{no.wizard.courtCount}</label>
                    <input className="input" type="number" min={1} max={12} value={courtCount} style={{ width: 100 }}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(12, Number(e.target.value) || 1));
                        setCourtCount(n);
                        setCourtNames((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? `Bane ${i + 1}`));
                      }} />
                  </div>
                  <div className="stack" style={{ gap: 8 }}>
                    {Array.from({ length: courtCount }, (_, i) => (
                      <input key={i} className="input" value={courtNames[i] ?? `Bane ${i + 1}`}
                        onChange={(e) => setCourtNames(courtNames.map((c, j) => j === i ? e.target.value : c))} />
                    ))}
                  </div>
                </>
              )}
            </Step>
          )}

          {step === 6 && showPlayoff && (
            <Step title={no.wizard.s6Title}>
              <div className="field">
                <label className="label">{no.wizard.playoffSize}</label>
                <div className="chips">
                  {[2, 4, 8].map((n) => (
                    <button key={n} className="chip" data-on={playoffSize === n} disabled={n > validTeams.length}
                      onClick={() => setPlayoffSize(n as 2 | 4 | 8)}>{n}</button>
                  ))}
                </div>
                <span className="faint">{no.wizard.playoffCapped(validTeams.length)} · {maxPlayoff} går videre</span>
              </div>
            </Step>
          )}

          {step === 7 && (
            <Step title={no.wizard.s7Title}>
              <Summary
                title={title} sport={sport} format={format} scoring={scoring}
                parallelism={parallelism} courtCount={courtCount}
                teamCount={validTeams.length} playoff={showPlayoff ? maxPlayoff : 0}
              />
              <button className="btn btn-block" onClick={saveTemplate} disabled={validTeams.length < 2}>
                💾 Lagre som mal
              </button>
            </Step>
          )}
        </div>

        <div className="spread">
          <button className="btn btn-ghost" onClick={back} disabled={step === 1}>{no.wizard.back}</button>
          {step < TOTAL ? (
            <button className="btn btn-gold" onClick={next} disabled={!canNext}>{no.wizard.next}</button>
          ) : (
            <button className="btn btn-gold btn-lg" onClick={create} disabled={creating || validTeams.length < 2}>
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
  d: { title: string; validTeams: unknown[]; courtNames: string[]; courtCount: number; parallelism: Parallelism },
): boolean {
  if (step === 4) return d.validTeams.length >= 2;
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
  return (
    <label style={{ cursor: "pointer" }} title="Logo">
      <input type="file" accept="image/*" hidden disabled={busy}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            const u = await api.uploadLogo(f);
            onUrl(u);
          } catch { /* ignore */ } finally { setBusy(false); }
        }} />
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

function Summary(props: {
  title: string; sport: string; format: Format; scoring: ScoringConfig;
  parallelism: Parallelism; courtCount: number; teamCount: number; playoff: number;
}) {
  const matchCount = useMemo(() => {
    if (props.format === "cup") return props.teamCount - 1;
    return roundRobinMatchCount(props.teamCount);
  }, [props.format, props.teamCount]);
  const rounds = props.format === "cup" ? null : roundRobinRoundCount(props.teamCount);

  const rows: [string, string][] = [
    [no.wizard.s1Name, props.title || "—"],
    [no.wizard.s1Sport, props.sport || "—"],
    [no.wizard.summaryFormat, no.wizard.formats[props.format].name],
    [no.wizard.summaryScoring, no.wizard.profiles[props.scoring.profile].name],
    [no.wizard.summaryTeams, String(props.teamCount)],
    [no.wizard.summaryCourts, props.parallelism === "parallel" ? String(props.courtCount) : no.wizard.sequential],
    ["Kamper", `${matchCount}${rounds ? ` · ${rounds} runder` : ""}`],
  ];
  if (props.playoff) rows.push([no.wizard.s6Title, `${props.playoff} lag`]);

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
