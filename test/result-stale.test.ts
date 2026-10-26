import { describe, it, expect } from "vitest";
import { pairingOf, teamsChangedSince, versionToSend } from "@/lib/client/resultStale";
import { no } from "@/lib/locale/no";

describe("åpent resultatvindu og lagbytte (C7)", () => {
  const m = (home: string | null, away: string | null) => ({ home_team_id: home, away_team_id: away });

  it("samme par → ikke endret; byttet hjemme-, bortelag eller tømt → endret", () => {
    const base = pairingOf(m("a", "b"));
    expect(teamsChangedSince(base, m("a", "b"))).toBe(false);
    expect(teamsChangedSince(base, m("c", "b"))).toBe(true);
    expect(teamsChangedSince(base, m("a", "c"))).toBe(true);
    expect(teamsChangedSince(base, m("a", null))).toBe(true);
    expect(teamsChangedSince(base, m("b", "a"))).toBe(true); // plassbytte
  });

  it("versjonen følger ferskeste kamp, men står stille når paret er byttet", () => {
    expect(versionToSend(3, 4, false)).toBe(4);
    expect(versionToSend(3, 4, true)).toBe(3);
  });

  it("det finnes en tydelig norsk melding, og den gamle utboksteksten nevner ikke bare «annen enhet»", () => {
    expect(no.control.matchTeamsChanged).toMatch(/Lagene i kampen er endret/);
    expect(no.control.unsentRejected).toMatch(/Kampen ble endret etter at resultatet ble lagt inn/);
  });
});
