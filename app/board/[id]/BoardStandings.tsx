"use client";

import { no } from "@/lib/locale/no";
import { initials } from "@/lib/client/view";
import { groupLabel } from "./Standings";
import type { StandingRow, Team } from "@/lib/types";

// Tabellen på storskjermen. Egen komponent (ikke Standings.tsx, som kontroll-
// og resultatsidene deler): her skal radhøyden skaleres slik at alt alltid
// passer, kolonnene forklares, og sluttspillgrensen står med navn.
//
// Layout er ren CSS: `planStandings` teller «linjer» (en linje = en rad), React
// setter `--lines` på boksen, og CSS gjør rad- og skriftstørrelse til
// min(ønsket, tilgjengelig høyde / linjer). Ingen måling i JS.

/** Radene i tabellene kan deles på to kolonner når de ikke ellers får lesbar høyde. */
const MAX_LINES_ONE_COLUMN = 15;
/** Ekstra høyde (i linjer) for sluttspillstreken med tekst og for forklaringslinja. */
const CUT_LINES = 0.8;
const LEGEND_LINES = 1.7;
const TABLE_GAP_LINES = 0.5;

interface PlanTable {
  /** Gruppenavn (kun gruppespill). */
  title?: string;
  rows: StandingRow[];
}

export interface StandingsPlan {
  /** Én eller to kolonner med tabeller. */
  columns: PlanTable[][];
  /** Høyde i «linjer» for den høyeste kolonnen, inkl. forklaringslinja. */
  lines: number;
  /** To kolonner: bare K, ± og P vises så lagnavnene får plass. */
  slim: boolean;
}

/** Trim to `limit` rows but never hide the cut line (the row just above the
 * playoff boundary). Same rule as Standings.tsx, so board and control agree. */
function capRows(standings: StandingRow[], limit?: number): StandingRow[] {
  if (!limit || standings.length <= limit) return standings;
  const cut = standings.findIndex((r, i) => r.inPlayoff && !standings[i + 1]?.inPlayoff);
  const keep = Math.max(limit, cut >= 0 ? cut + 1 : 0);
  return standings.slice(0, keep);
}

/** True when the table has a playoff cut with at least one team below it. */
function hasCut(rows: StandingRow[]): boolean {
  return rows.some((r, i) => r.inPlayoff && rows[i + 1] && !rows[i + 1].inPlayoff);
}

function tableLines(t: PlanTable): number {
  return (t.title ? 1 : 0) + 1 + t.rows.length + (hasCut(t.rows) ? CUT_LINES : 0);
}

export function planStandings(
  standings: StandingRow[],
  groups: { group_no: number; rows: StandingRow[] }[] | null | undefined,
  limit?: number,
): StandingsPlan {
  const tables: PlanTable[] =
    groups && groups.length > 0
      ? groups.map((g) => ({ title: groupLabel(g.group_no), rows: capRows(g.rows, limit) }))
      : [{ rows: capRows(standings, limit) }];

  const stacked = tables.reduce((s, t) => s + tableLines(t) + TABLE_GAP_LINES, -TABLE_GAP_LINES);
  let columns: PlanTable[][] = [tables];
  if (stacked > MAX_LINES_ONE_COLUMN) {
    if (tables.length > 1) {
      // Fordel gruppene så kolonnene blir omtrent like høye.
      const half = Math.ceil(tables.length / 2);
      columns = [tables.slice(0, half), tables.slice(half)];
    } else {
      const rows = tables[0].rows;
      const half = Math.ceil(rows.length / 2);
      columns = [[{ rows: rows.slice(0, half) }], [{ rows: rows.slice(half) }]];
    }
  }
  columns = columns.filter((c) => c.length > 0 && c.some((t) => t.rows.length > 0));
  const colLines = columns.map((c) =>
    c.reduce((s, t) => s + tableLines(t) + TABLE_GAP_LINES, -TABLE_GAP_LINES),
  );
  return {
    columns,
    lines: Math.max(...colLines, 2) + LEGEND_LINES,
    slim: columns.length > 1,
  };
}

export function BoardStandings({
  plan,
  teams,
  showDraw,
}: {
  plan: StandingsPlan;
  teams: Map<string, Team>;
  showDraw: boolean;
}) {
  const all = plan.columns.flat().flatMap((t) => t.rows);
  if (all.length === 0) return <div className="empty">{no.board.noMatches}</div>;
  const showBuchholz = all.some((r) => r.buchholz !== undefined);
  const cols: Cols = {
    wdl: !plan.slim,
    draw: showDraw && !plan.slim,
    buchholz: showBuchholz && !plan.slim,
  };

  return (
    <div className="bstand-box" style={{ ["--lines" as string]: plan.lines }}>
      <div className="bstand">
        <div className="bstand-cols" data-cols={plan.columns.length}>
          {plan.columns.map((tables, ci) => (
            <div className="bstand-col" key={ci}>
              {tables.map((t, ti) => (
                <Table key={ti} table={t} teams={teams} cols={cols} />
              ))}
            </div>
          ))}
        </div>
        <Legend cols={cols} />
      </div>
    </div>
  );
}

interface Cols {
  wdl: boolean;
  draw: boolean;
  buchholz: boolean;
}

function Th({
  short,
  full,
  title,
  cls,
}: {
  short: string;
  full: string;
  title?: string;
  cls?: string;
}) {
  return (
    <th title={title ?? full} className={cls}>
      <span className="th-s">{short}</span>
      <span className="th-f">{full}</span>
    </th>
  );
}

function Table({
  table,
  teams,
  cols,
}: {
  table: PlanTable;
  teams: Map<string, Team>;
  cols: Cols;
}) {
  const th = no.board.th;
  const f = no.board.thFull;
  const span = 4 + (cols.wdl ? 2 : 0) + (cols.draw ? 1 : 0) + (cols.buchholz ? 1 : 0);
  return (
    <div className="bstand-table">
      {table.title && <h3 className="bstand-group">{table.title}</h3>}
      <table>
        <thead>
          <tr>
            <th className="rank">{th.rank}</th>
            <th className="l">{th.team}</th>
            <Th short={th.p} full={f.p} />
            {cols.wdl && <Th short={th.w} full={f.w} cls="c-x" />}
            {cols.draw && <Th short={th.d} full={f.d} cls="c-x" />}
            {cols.wdl && <Th short={th.l} full={f.l} cls="c-x" />}
            <Th short={th.diff} full={f.diff} />
            <Th short={th.pts} full={f.pts} />
            {cols.buchholz && <Th short={th.buchholz} full={f.buchholz} title={no.board.buchholzTitle} />}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => {
            const t = teams.get(r.team_id);
            const next = table.rows[i + 1];
            const cut = r.inPlayoff && next && !next.inPlayoff;
            return (
              <RowFragment key={r.team_id} cut={!!cut} span={span}>
                <tr className={cut ? "cut" : undefined}>
                  <td className="rank">{r.rank}</td>
                  <td className="l">
                    <span className="team">
                      {t?.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="team-logo" src={t.logo_url} alt="" />
                      ) : (
                        <span className="team-swatch" style={{ background: t?.colour }} />
                      )}
                      <span className="team-name">{t?.name ?? initials("?")}</span>
                    </span>
                  </td>
                  <td>{r.played}</td>
                  {cols.wdl && <td className="c-x">{r.won}</td>}
                  {cols.draw && <td className="c-x">{r.drawn}</td>}
                  {cols.wdl && <td className="c-x">{r.lost}</td>}
                  <td>{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                  <td className="pts">{r.points}</td>
                  {cols.buchholz && <td>{r.buchholz ?? 0}</td>}
                </tr>
              </RowFragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A row, plus the labelled playoff line right after the last qualifying row. */
function RowFragment({
  cut,
  span,
  children,
}: {
  cut: boolean;
  span: number;
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      {cut && (
        <tr className="cut-label">
          <td colSpan={span}>{no.board.advances}</td>
        </tr>
      )}
    </>
  );
}

/** One line under the table that spells out the column letters. Hidden when
 * the container is wide enough for the header to show the full words. */
function Legend({ cols }: { cols: Cols }) {
  const th = no.board.th;
  const f = no.board.thFull;
  // `c-x` items vanish together with their columns when the table is narrow.
  const items: [string, string, boolean][] = [[th.p, f.p, false]];
  if (cols.wdl) items.push([th.w, f.w, true]);
  if (cols.draw) items.push([th.d, f.d, true]);
  if (cols.wdl) items.push([th.l, f.l, true]);
  items.push([th.diff, f.diff, false], [th.pts, f.pts, false]);
  if (cols.buchholz) items.push([th.buchholz, f.buchholz, false]);
  return (
    <p className="bstand-legend">
      {items.map(([s, w, x]) => (
        <span key={s} className={x ? "c-x" : undefined}>
          <b>{s}</b> {w.toLowerCase()}
        </span>
      ))}
      {cols.buchholz && <span className="bstand-legend-note">{no.board.buchholzTitle.split(": ")[1]}</span>}
    </p>
  );
}
