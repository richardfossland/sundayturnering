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
}: {
  standings: StandingRow[];
  teams: Map<string, Team>;
  showDraw: boolean;
}) {
  if (standings.length === 0)
    return <div className="empty">{no.board.noMatches}</div>;
  return <StandingsTable standings={standings} teams={teams} showDraw={showDraw} />;
}

/** Several group tables stacked (group_playoff format). */
export function GroupStandings({
  groups,
  teams,
  showDraw,
}: {
  groups: { group_no: number; rows: StandingRow[] }[];
  teams: Map<string, Team>;
  showDraw: boolean;
}) {
  if (!groups.length)
    return <div className="empty">{no.board.noMatches}</div>;
  return (
    <div className="stack" style={{ gap: 18 }}>
      {groups.map((g) => (
        <div key={g.group_no} className="stack" style={{ gap: 8 }}>
          <h3 className="group-head">{groupLabel(g.group_no)}</h3>
          <StandingsTable standings={g.rows} teams={teams} showDraw={showDraw} />
        </div>
      ))}
    </div>
  );
}

function StandingsTable({
  standings,
  teams,
  showDraw,
}: {
  standings: StandingRow[];
  teams: Map<string, Team>;
  showDraw: boolean;
}) {
  const th = no.board.th;
  const showForm = standings.some((r) => (r.form?.length ?? 0) > 0);
  return (
    <table className="standings">
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
        {standings.map((r) => {
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
