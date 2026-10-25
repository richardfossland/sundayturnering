import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Bracket } from "@/app/board/[id]/Bracket";
import type { Match, ScoringConfig, Team } from "@/lib/types";

const scoring = { profile: "simple" } as unknown as ScoringConfig;

function team(id: string): Team {
  return { id, name: `Lag ${id}`, colour: "#f00", logo_url: null } as Team;
}
function match(id: string, round: number, slot: number, extra: Partial<Match> = {}): Match {
  return {
    id,
    phase: "playoff",
    round,
    bracket_slot: slot,
    status: "scheduled",
    home_team_id: null,
    away_team_id: null,
    winner_team_id: null,
    result: null,
    scheduled_at: null,
    ...extra,
  } as Match;
}

describe("Bracket (render)", () => {
  it("tegner kolonner, koder og opprinnelsesetiketter", () => {
    const teams = new Map([team("a"), team("b")].map((t) => [t.id, t]));
    const matches = [
      match("m1", 1, 0, { home_team_id: "a", away_team_id: "b", status: "live" }),
      match("m2", 1, 1),
      match("f", 2, 0),
    ];
    const html = renderToStaticMarkup(
      createElement(Bracket, { matches, teams, scoring }),
    );
    expect(html).toContain("Semifinale");
    expect(html).toContain("Vinner av SF1");
    expect(html).toContain("Lag a");
    expect(html).toContain("brk-state live");
  });

  it("uten sluttspillkamper vises tom-tilstand", () => {
    const html = renderToStaticMarkup(
      createElement(Bracket, { matches: [], teams: new Map(), scoring }),
    );
    expect(html).toContain("Ingen kamper ennå");
  });
});
