"use client";

import Link from "next/link";
import { Icon } from "@/lib/client/Icon";
import { no } from "@/lib/locale/no";
import { CourtsSection } from "@/lib/client/organiser/CourtsSection";
import { OverrideSection } from "@/lib/client/organiser/OverrideSection";
import { ShiftSection } from "@/lib/client/organiser/ShiftSection";
import { TimerSection } from "@/lib/client/organiser/TimerSection";
import { TournamentSection } from "@/lib/client/organiser/TournamentSection";
import { OrganiserCodeField, useGuard, useOrganiserCode, type ToolsCtx } from "@/lib/client/organiser/shared";
import type { Flash } from "@/lib/client/useToast";
import type { Court, Match, Team } from "@/lib/types";
import type { TournamentDTO } from "@/lib/dto";

// The «Arrangør» tab of the referee page. The tools themselves live in
// lib/client/organiser/ and are shared with Kontrollsenter (/arrangor/[id]);
// this is the link to Kontrollsenter, the code field (when this device does not
// hold the code yet) and the sections in one column.
export function OrganiserPanel({
  tournament,
  matches,
  teams,
  courts,
  onChanged,
  flash,
}: {
  tournament: TournamentDTO;
  matches: Match[];
  teams: Map<string, Team>;
  courts: Court[];
  onChanged: () => void;
  flash: Flash;
}) {
  const { code, setCode } = useOrganiserCode(tournament.id);
  const { busy, guard } = useGuard(onChanged, flash);

  const ctx: ToolsCtx = { tournament, matches, teams, courts, code, busy, guard, flash, onChanged };

  return (
    <div className="stack org-panel">
      <Link href={`/arrangor/${tournament.id}`} className="btn btn-gold btn-lg btn-block">
        <Icon name="settings" />
        {no.tools.openCenter}
      </Link>
      <a className="btn btn-block" href={`/resultat/${tournament.id}`} target="_blank" rel="noopener">
        <Icon name="award" />
        {no.hub.results}
      </a>

      {!code && <p className="hint org-locked" role="status">{no.control.organiserLocked}</p>}
      <OrganiserCodeField code={code} onChange={setCode} />

      <TournamentSection {...ctx} />
      <TimerSection {...ctx} />
      {courts.length > 0 && <CourtsSection {...ctx} />}
      {tournament.config?.schedule && <ShiftSection {...ctx} />}
      <OverrideSection {...ctx} />
    </div>
  );
}
