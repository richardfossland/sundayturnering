"use client";

import { useState } from "react";
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

// The referee page's organiser panel (opened from the bottom of the list).
// The tools themselves live in lib/client/organiser/ and are shared with
// Kontrollsenter (/arrangor/[id]); this is just the code field + the sections
// in one column. D4 moves it to a tab of its own.
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
  const [openPanel, setOpenPanel] = useState(false);
  const { code, setCode } = useOrganiserCode(tournament.id);
  const { busy, guard } = useGuard(onChanged, flash);

  if (!openPanel)
    return (
      <button className="btn btn-ghost btn-block" onClick={() => setOpenPanel(true)}>
        <Icon name="settings" />
        {no.control.organiser}
      </button>
    );

  const ctx: ToolsCtx = { tournament, matches, teams, courts, code, busy, guard, flash, onChanged };

  return (
    <div className="card card-pad stack org-panel">
      <div className="spread">
        <h2 className="org-panel-title">{no.control.organiser}</h2>
        <button className="btn btn-ghost" onClick={() => setOpenPanel(false)} aria-label={no.common.close}>
          <Icon name="close" />
        </button>
      </div>

      <div className="btn-row">
        <Link href={`/arrangor/${tournament.id}`} className="btn">
          <Icon name="settings" />
          {no.tools.openCenter}
        </Link>
        <a className="btn" href={`/resultat/${tournament.id}`} target="_blank" rel="noopener">
          <Icon name="award" />
          {no.hub.results}
        </a>
      </div>

      <OrganiserCodeField code={code} onChange={setCode} />

      <TournamentSection {...ctx} />
      <TimerSection {...ctx} />
      {courts.length > 0 && <CourtsSection {...ctx} />}
      {tournament.config?.schedule && <ShiftSection {...ctx} />}
      <OverrideSection {...ctx} />
    </div>
  );
}
