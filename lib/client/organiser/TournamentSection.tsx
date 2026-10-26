"use client";

import { api, ApiError } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import { swissProgress } from "@/lib/tournament/swiss";
import { ToolSection, type ToolsCtx } from "./shared";

/** «Turneringen»: move on to the next phase (sluttspill / neste runde) and,
 * set apart at the bottom, finish or reopen. Confirm texts are unchanged. */
export function TournamentSection({ tournament, matches, code, busy, guard, flash }: ToolsCtx) {
  const canAdvance =
    (tournament.format === "league_playoff" || tournament.format === "group_playoff") &&
    tournament.status === "league";
  const swiss =
    tournament.format === "swiss" && tournament.status === "league"
      ? swissProgress(matches, tournament.config?.swiss?.rounds ?? 0)
      : null;
  // «Start neste runde» når runden er ferdig og det er flere igjen.
  const canNextRound = !!swiss && swiss.complete && swiss.round < swiss.total;
  const canFinish = tournament.status !== "finished";
  const canReopen = tournament.status === "finished";

  const hint = canReopen
    ? no.tools.hintFinished
    : canAdvance
      ? no.tools.hintLeague
      : swiss
        ? no.tools.hintSwiss
        : no.tools.hintPlay;

  return (
    <ToolSection id="tournament" title={no.tools.tournamentTitle} intro={no.tools.tournamentIntro}>
      <p className="hint">{hint}</p>
      {swiss && <p className="org-status" data-on="true">{no.board.swissRound(swiss.round, swiss.total)}</p>}

      {(canAdvance || canNextRound) && (
        <div className="btn-row">
          {canAdvance && (
            <button
              type="button"
              className="btn btn-gold"
              disabled={busy || !code}
              onClick={async () => {
                if (!confirm(no.control.advanceConfirm)) return;
                const r = await guard(async () => {
                  try {
                    return await api.advance(tournament.id, code);
                  } catch (e) {
                    // Unplayed league/group matches: only on purpose.
                    if (!(e instanceof ApiError && e.code === "uspilte_kamper")) throw e;
                    if (!confirm(no.control.advanceUnplayed(Number(e.data?.count ?? 0))))
                      return null;
                    return await api.advance(tournament.id, code, { force: true });
                  }
                });
                if (r) flash(no.control.advancePlayoff);
              }}
            >
              {no.control.advancePlayoff}
            </button>
          )}
          {canNextRound && swiss && (
            <button
              type="button"
              className="btn btn-gold"
              disabled={busy || !code}
              onClick={async () => {
                if (!confirm(no.control.nextRoundConfirm)) return;
                const r = await guard(() => api.advance(tournament.id, code));
                if (r) flash(no.control.nextRoundDone(swiss.round + 1));
              }}
            >
              {no.control.nextRound}
            </button>
          )}
        </div>
      )}

      <div className="org-danger">
        <div className="label">{no.tools.dangerTitle}</div>
        <div className="btn-row">
          {canFinish && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || !code}
              onClick={async () => {
                if (!confirm(no.control.finishConfirm)) return;
                await guard(async () => {
                  try {
                    return await api.finish(tournament.id, code);
                  } catch (e) {
                    // B-sluttspill/trøsterunde ikke ferdig: bare med vilje.
                    if (!(e instanceof ApiError && e.code === "b_sluttspill_pagar")) throw e;
                    if (!confirm(no.control.finishBOpen(Number(e.data?.count ?? 0)))) return null;
                    return await api.finish(tournament.id, code, { force: true });
                  }
                });
              }}
            >
              {no.control.finish}
            </button>
          )}
          {canReopen && (
            <button
              type="button"
              className="btn"
              disabled={busy || !code}
              onClick={async () => {
                if (!confirm(no.control.reopenConfirm)) return;
                const r = await guard(() => api.reopen(tournament.id, code));
                if (r) flash(no.control.reopened);
              }}
            >
              {no.control.reopen}
            </button>
          )}
        </div>
      </div>
    </ToolSection>
  );
}
