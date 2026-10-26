"use client";

import type { OutboxEntry } from "@/lib/client/outbox";
import { matchTime } from "@/lib/client/view";
import { resolve } from "@/lib/tournament/scoring";
import { canSelfCorrect, selfCorrectMsLeft, type Owned } from "@/lib/tournament/correct";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import type { Court, Match, ScoringProfileKey, Team } from "@/lib/types";
import { TimerLeft, fmtClock, useNow } from "./clock";

/** One match in the referee list. The card has ONE primary action that depends
 * on where the match is — Start kamp (planned), Før resultat (playing), Endre
 * (done, inside the self-correct window) — and tapping the card body does the
 * same thing as that button. Nothing is hidden behind a tap target that has no
 * label. */
export function MatchCard({
  m,
  teams,
  courts,
  profile,
  owned,
  correctable,
  unsent,
  timerEndsAt,
  flag,
  starting,
  onDismissUnsent,
  onEnterScore,
  onCorrect,
  onStart,
  onLocked,
}: {
  m: Match;
  teams: Map<string, Team>;
  courts: Court[];
  profile: ScoringProfileKey;
  /** What this phone remembers of saving this match's result (identity.ownedResult). */
  owned: Owned | null;
  /** The tournament state still allows a referee correction (see correctBlock). */
  correctable: boolean;
  /** A result for this match waits in the outbox: show it, block a second entry. */
  unsent: OutboxEntry | null;
  /** When this match's countdown ends (live cards only). */
  timerEndsAt: number | null;
  /** «Din neste kamp» (first planned match) or «Lagret» (just saved). */
  flag: "next" | "saved" | null;
  /** «Start kamp» has been sent and is waiting for the server. */
  starting: boolean;
  onDismissUnsent: (requestId: string) => void;
  onEnterScore: () => void;
  onCorrect: () => void;
  onStart: () => void;
  /** Tapped a finished card that can no longer be edited by this device. */
  onLocked: () => void;
}) {
  // Only finished cards run the self-correct countdown clock.
  const now = useNow(m.status === "done");
  const correctMsLeft =
    now && correctable && canSelfCorrect(m, owned, now)
      ? selfCorrectMsLeft(m, now)
      : null;
  const h = m.home_team_id ? teams.get(m.home_team_id) : null;
  const a = m.away_team_id ? teams.get(m.away_team_id) : null;
  const court = courts.find((c) => c.id === m.court_id);
  const locked = m.locked_by && m.status !== "done";
  // The public match carries only the holder's NAME (never the device id).
  const lockName = locked ? m.locked_by : null;
  const r = m.result ? resolve(profile, m.result) : null;
  const ready = !!(h && a);
  const planned = m.status === "scheduled" || m.status === "called";
  const unsentScore = unsent ? resolve(profile, unsent.payload.result).display : null;
  // A failed entry no longer blocks: the referee may re-enter the score.
  const blocked = !!unsent && !unsent.failed;
  const homeWon = !!(m.winner_team_id && m.winner_team_id === m.home_team_id);
  const awayWon = !!(m.winner_team_id && m.winner_team_id === m.away_team_id);
  const time = m.status !== "done" ? matchTime(m.scheduled_at) : null;

  // The one primary action for this card (null = nothing to do right now).
  type Primary = { label: string; run: () => void; tone: "gold" | "plain" | "ghost" };
  let primary: Primary | null = null;
  if (!blocked && ready) {
    if (unsent?.failed && m.status !== "done")
      primary = { label: no.control.enterScore, run: onEnterScore, tone: "gold" };
    else if (planned)
      primary = { label: no.control.startMatch, run: starting ? noop : onStart, tone: flag === "next" ? "gold" : "plain" };
    else if (m.status === "live")
      primary = { label: no.control.enterScore, run: onEnterScore, tone: "gold" };
    else if (m.status === "done" && correctMsLeft != null)
      primary = { label: `${no.control.edit} (${fmtClock(correctMsLeft)})`, run: onCorrect, tone: "ghost" };
  }
  // Tapping the body of a planned card only opens the result sheet (a lock that
  // is released on close). Starting a match makes it live on the storskjerm and
  // restarts that court's countdown, so that needs the explicit button.
  const bodyRun = primary && planned && !unsent ? onEnterScore : primary?.run;
  // A finished card nobody here can edit explains itself instead of staying silent.
  const needsOrganiser = m.status === "done" && now > 0 && correctMsLeft == null && !unsent;

  const body = (
    <>
      {(time || court || unsentScore || m.status === "live" || m.status === "called") && (
        <div className="mcard-meta">
          <span className="mcard-when">
            {time}
            {time && court ? <span className="mcard-dot" aria-hidden="true">·</span> : null}
            {court?.name}
          </span>
          <span className="mcard-pills">
            {unsentScore ? (
              <span className="pill pill-unsent" role={unsent?.failed ? "alert" : undefined}>
                {no.control.unsentCard(unsentScore)}
              </span>
            ) : m.status === "live" ? (
              <span className="pill pill-live"><span className="dot" />{no.control.live}</span>
            ) : m.status === "called" ? (
              <span className="pill pill-called">{court ? no.control.calledTo(court.name) : no.board.calledUp}</span>
            ) : null}
            {m.status === "live" && timerEndsAt != null && (
              <span className="mcard-timer" title={no.control.countdownTitle}>
                <Icon name="clock" size={14} />
                <TimerLeft endsAt={timerEndsAt} />
              </span>
            )}
          </span>
        </div>
      )}
      <div className="mcard-main">
        <div className="mcard-teams">
          <TeamLine team={h} win={m.status === "done" && homeWon} />
          <TeamLine team={a} win={m.status === "done" && awayWon} />
        </div>
        {m.status === "done" && r && !unsentScore && (
          // Full scoreline (e.g. "2–1 (25–20, 23–25, 15–10)") — not truncated
          // to the set tally, so judges see exactly what was entered.
          <span className="match-result">{r.display}</span>
        )}
      </div>
      {lockName && <div className="mcard-note mcard-note-warn">{no.control.lockedBy(lockName)}</div>}
      {unsent?.failed && <div className="mcard-note mcard-note-warn">{no.control.unsentFailed}</div>}
      {!ready && planned && <div className="mcard-note">{no.control.waitingTeams}</div>}
    </>
  );

  return (
    <article
      className="mcard"
      data-status={m.status}
      data-locked={!!locked}
      data-flag={flag ?? undefined}
    >
      {flag && (
        <div className="mcard-flag">
          <Icon name={flag === "saved" ? "check" : "live"} size={16} strokeWidth={2.4} />
          {flag === "saved" ? no.control.savedBadge : no.control.nextMatch}
        </div>
      )}
      {primary ? (
        <div
          className="mcard-body mcard-body-action"
          role="button"
          tabIndex={0}
          onClick={bodyRun}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              bodyRun?.();
            }
          }}
        >
          {body}
        </div>
      ) : (
        <div
          className="mcard-body"
          // Finished and past the edit window: a tap says why nothing happens.
          onClick={needsOrganiser ? onLocked : undefined}
        >
          {body}
        </div>
      )}
      {(primary || unsent?.failed || needsOrganiser) && (
        <div className="mcard-foot">
          {primary && (
            <button
              type="button"
              className={`btn btn-lg mcard-primary${primary.tone === "gold" ? " btn-gold" : primary.tone === "ghost" ? " btn-ghost" : ""}`}
              disabled={starting}
              onClick={primary.run}
            >
              {starting ? <span className="spin" /> : null}
              {primary.label}
            </button>
          )}
          {/* Many referees only report afterwards — they may skip "Start kamp". */}
          {primary && planned && !unsent && (
            <button type="button" className="btn btn-ghost" onClick={onEnterScore}>
              {no.control.enterScore}
            </button>
          )}
          {unsent?.failed && (
            <button type="button" className="btn" onClick={() => onDismissUnsent(unsent.requestId)}>
              {no.control.unsentDismiss}
            </button>
          )}
          {needsOrganiser && <span className="mcard-hint">{no.control.askOrganiser}</span>}
        </div>
      )}
    </article>
  );
}

function noop() {}

function TeamLine({ team, win = false }: { team: Team | null | undefined; win?: boolean }) {
  return (
    <span className={`team mcard-team${win ? " team-win" : ""}`}>
      {/* team colour is data, not styling */}
      <span className="team-swatch" style={{ background: team?.colour ?? "#555" }} />
      <span className="team-name">{team?.name ?? no.board.tbd}</span>
      {win && (
        <span className="win-mark" role="img" aria-label={no.common.winner} title={no.common.winner}>
          <Icon name="check" size={18} strokeWidth={2.5} />
        </span>
      )}
    </span>
  );
}
