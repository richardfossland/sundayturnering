"use client";

import { no } from "@/lib/locale/no";
import { initials } from "@/lib/client/view";
import type { StandingRow, Team } from "@/lib/types";

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

  const th = no.board.th;
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
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
