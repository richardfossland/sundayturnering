"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { identity } from "@/lib/client/identity";
import { errorMessage } from "@/lib/locale/errors";
import type { Flash } from "@/lib/client/useToast";
import type { Court, Match, Team } from "@/lib/types";
import type { TournamentDTO } from "@/lib/dto";
import { no } from "@/lib/locale/no";

// Shared by Kontrollsenter (/arrangor/[id]) and the referee page's organiser
// panel, so the organiser tools exist once: same logic, same code handling.

export type Guard = <T>(fn: () => Promise<T>) => Promise<T | null>;

/** What every tool section needs to read the tournament and to act on it. */
export interface ToolsCtx {
  tournament: TournamentDTO;
  matches: Match[];
  teams: Map<string, Team>;
  courts: Court[];
  /** Organiser code held by this device ("" = tools are locked). */
  code: string;
  busy: boolean;
  guard: Guard;
  flash: Flash;
  /** Refetch the tournament after something changed outside `guard`. */
  onChanged: () => void;
}

/** The organiser code for one tournament: read from this device after mount
 * (SSR has no storage) and written back as it is typed or cleared. `fallback`
 * covers a code that "Mine turneringer" holds but the per-tournament key lost. */
export function useOrganiserCode(id: string, fallback = "") {
  const [code, setCodeState] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read stored code post-mount
    setCodeState(identity.organiserCode(id) || fallback);
  }, [id, fallback]);
  const setCode = useCallback(
    (c: string) => {
      setCodeState(c);
      identity.setOrganiserCode(id, c);
    },
    [id],
  );
  return { code, setCode };
}

/** Runs an organiser action: `busy` while it is in flight, refetch when it
 * worked, an error toast when it did not (null result). */
export function useGuard(onChanged: () => void, flash: Flash) {
  const [busy, setBusy] = useState(false);
  const guard = useCallback<Guard>(
    async (fn) => {
      setBusy(true);
      try {
        const r = await fn();
        onChanged();
        return r;
      } catch (e) {
        flash(errorMessage(e), "error");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [onChanged, flash],
  );
  return { busy, guard };
}

/** One titled tool: heading, a one-sentence explanation, then its controls.
 * Layout (card vs divided list) is decided by the parent's CSS class. */
export function ToolSection({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section className="org-section" aria-labelledby={`${id}-title`}>
      <header className="org-section-head">
        <h3 id={`${id}-title`} className="org-section-title">{title}</h3>
        <p className="org-section-intro">{intro}</p>
      </header>
      <div className="org-section-body">{children}</div>
    </section>
  );
}

/** «Home – Away» for a match; "?" for a side that is not decided yet. */
export function matchLabeler(teams: Map<string, Team>) {
  const teamName = (id: string | null) => (id ? (teams.get(id)?.name ?? "?") : "?");
  const label = (m: Match) => `${teamName(m.home_team_id)} – ${teamName(m.away_team_id)}`;
  return { teamName, label };
}

/** The organiser-code input: shown on the referee page's panel and, when the
 * code is not on this device, on Kontrollsenter. */
export function OrganiserCodeField({
  code,
  onChange,
  id = "organiser-code",
}: {
  code: string;
  onChange: (c: string) => void;
  id?: string;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{no.control.organiserCode}</label>
      <input
        id={id}
        className="input"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={code}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="KODE-XX"
      />
      <span className="hint">{no.control.organiserHint}</span>
    </div>
  );
}
