"use client";

import { no } from "@/lib/locale/no";
import { initials } from "@/lib/client/view";
import type { StandingRow, Team } from "@/lib/types";

/** Group label from a 0-based group number: 0 → "Gruppe A". */
export function groupLabel(groupNo: number): string {
  return `${no.board.group} ${String.fromCharCode(65 + groupNo)}`;
}

export function Standings({
  standings,
  teams,
  showDraw,
  limit,
  compact = false,
}: {
  standings: StandingRow[];
  teams: Map<string, Team>;
  showDraw: boolean;
  /** Cap the number of rows shown (keeps an always-on board panel scroll-free).
   * The cut-line row is kept visible even when it would fall past the limit. */
  limit?: number;
  /** Tighter type/padding for an embedded strip (control + always-on board). */
  compact?: boolean;
}) {
  if (standings.length === 0)
    return <div className="empty">{no.board.noMatches}</div>;
  return (
    <StandingsTable
      standings={standings}
      teams={teams}
      showDraw={showDraw}
      limit={limit}
      compact={compact}
    />
  );
}

/** Several group tables stacked (group_playoff format). */
export function GroupStandings({
  groups,
  teams,
  showDraw,
  limit,
  compact = false,
}: {
  groups: { group_no: number; rows: StandingRow[] }[];
  teams: Map<string, Team>;
  showDraw: boolean;
  limit?: number;
  compact?: boolean;
}) {
  if (!groups.length)
    return <div className="empty">{no.board.noMatches}</div>;
  return (
    <div className="stack" style={{ gap: compact ? 12 : 18 }}>
      {groups.map((g) => (
        <div key={g.group_no} className="stack" style={{ gap: 8 }}>
          <h3 className="group-head">{groupLabel(g.group_no)}</h3>
          <StandingsTable
            standings={g.rows}
            teams={teams}
            showDraw={showDraw}
            limit={limit}
            compact={compact}
          />
        </div>
      ))}
    </div>
  );
}

/** Trim to `limit` rows but never hide the cut line (the row just above the
 * playoff boundary), so the always-on board still tells the qualifying story. */
function capRows(standings: StandingRow[], limit?: number): StandingRow[] {
  if (!limit || standings.length <= limit) return standings;
  const cut = standings.findIndex(
    (r, i) => r.inPlayoff && !standings[i + 1]?.inPlayoff,
  );
  const keep = Math.max(limit, cut >= 0 ? cut + 1 : 0);
  return standings.slice(0, keep);
}

function StandingsTable({
  standings,
  teams,
  showDraw,
  limit,
  compact = false,
}: {
  standings: StandingRow[];
  teams: Map<string, Team>;
  showDraw: boolean;
  limit?: number;
  compact?: boolean;
}) {
  const th = no.board.th;
  const rows = capRows(standings, limit);
  const showForm = !compact && rows.some((r) => (r.form?.length ?? 0) > 0);
  return (
    <table className={`standings${compact ? " standings-compact" : ""}`}>
      <thead>
        <tr>
          <th>{th.rank}</th>
          <th className="l">{th.team}</th>
          <th>{th.p}</th>
          <th>{th.w}</th>
          {showDraw && <th>{th.d}</th>}
          <th>{th.l}</th>
          <th>{th.diff}</th>
          <th>{th.pts}</th>
          {showForm && <th className="form-col">{th.form}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const t = teams.get(r.team_id);
          const lastInPlayoff =
            r.inPlayoff &&
            !standings.find((x) => x.rank === r.rank + 1)?.inPlayoff;
          return (
            <tr key={r.team_id} className={lastInPlayoff ? "cut" : undefined}>
              <td className="rank">{r.rank}</td>
              <td className="l">
                <span className="team">
                  {t?.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="team-logo" src={t.logo_url} alt="" />
                  ) : (
                    <span
                      className="team-swatch"
                      style={{ background: t?.colour, width: 14, height: 14 }}
                    />
                  )}
                  <span className="team-name">{t?.name ?? initials("?")}</span>
                </span>
              </td>
              <td>{r.played}</td>
              <td>{r.won}</td>
              {showDraw && <td>{r.drawn}</td>}
              <td>{r.lost}</td>
              <td>{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
              <td className="pts">{r.points}</td>
              {showForm && (
                <td className="form-col">
                  <FormDots form={r.form ?? []} />
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Last few results as coloured dots (W green, D grey, L red). */
export function FormDots({ form }: { form: ("W" | "D" | "L")[] }) {
  if (form.length === 0) return null;
  return (
    <span className="form-dots">
      {form.map((f, i) => (
        <span key={i} className="form-dot" data-r={f} title={f} />
      ))}
    </span>
  );
}
