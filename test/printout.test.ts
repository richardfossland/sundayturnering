import { describe, expect, it } from "vitest";
import {
  cardMatches,
  controlCourtUrl,
  controlMatchUrl,
  playoffRounds,
  programmeByCourt,
  programmeByTeam,
  roundText,
  scoreBoxes,
} from "@/lib/tournament/printout";
import {
  parseControlTarget,
  resolveControlTarget,
  withControlTarget,
} from "@/lib/client/controlTarget";
import type { Match, Team } from "@/lib/types";

let n = 0;
function match(p: Partial<Match> = {}): Match {
  n++;
  return {
    id: `m${n}-aaaaaaaa`,
    tournament_id: "t",
    phase: "league",
    round: 1,
    bracket_slot: null,
    group_no: null,
    court_id: null,
    queue_order: n,
    scheduled_at: null,
    called_at: null,
    home_team_id: "a",
    away_team_id: "b",
    status: "scheduled",
    result: null,
    winner_team_id: null,
    locked_by: null,
    result_by: null,
    result_version: 0,
    updated_at: "2026-01-01T00:00:00Z",
    ...p,
  };
}
const team = (id: string, sort_order: number): Team => ({
  id,
  tournament_id: "t",
  name: id.toUpperCase(),
  colour: "#fff",
  logo_url: null,
  seed: null,
  sort_order,
  members: [],
  group_no: null,
});
const courts = [
  { id: "c2", name: "Bane 2", sort_order: 1 },
  { id: "c1", name: "Bane 1", sort_order: 0 },
];

describe("cardMatches", () => {
  it("hopper over ferdige og fri runde, sorterer på tid så kø", () => {
    const late = match({ scheduled_at: "2026-05-01T10:00:00Z" });
    const early = match({ scheduled_at: "2026-05-01T09:00:00Z" });
    const noTime = match();
    const out = cardMatches([
      noTime,
      match({ status: "done" }),
      match({ status: "bye" }),
      late,
      early,
    ]);
    expect(out).toEqual([early, late, noTime]);
  });

  it("tar med kalt/live, og kan skjule ukjente lag", () => {
    const tbd = match({ away_team_id: null });
    const live = match({ status: "live" });
    const called = match({ status: "called" });
    expect(cardMatches([tbd, live, called])).toHaveLength(3);
    expect(cardMatches([tbd, live, called], true)).toEqual([live, called]);
  });
});

describe("programmeByCourt", () => {
  it("banene i rekkefølge, kamper uten bane til slutt, bye utelatt, ferdige med", () => {
    const a = match({ court_id: "c1", scheduled_at: "2026-05-01T10:00:00Z" });
    const b = match({ court_id: "c1", scheduled_at: "2026-05-01T09:00:00Z", status: "done" });
    const c = match({ court_id: "c2" });
    const d = match();
    const e = match({ court_id: "c1", status: "bye" });
    const out = programmeByCourt([a, b, c, d, e], courts);
    expect(out.map((g) => g.court?.id ?? null)).toEqual(["c1", "c2", null]);
    expect(out[0].matches).toEqual([b, a]);
  });

  it("utelater baner uten kamper", () => {
    expect(programmeByCourt([match({ court_id: "c2" })], courts).map((g) => g.court?.id)).toEqual([
      "c2",
    ]);
  });
});

describe("programmeByTeam", () => {
  it("gir hvert lag sine kamper, lagene i oppsettets rekkefølge", () => {
    const ab = match({ home_team_id: "a", away_team_id: "b" });
    const bc = match({ home_team_id: "b", away_team_id: "c" });
    const out = programmeByTeam([bc, ab, match({ status: "bye" })], [team("c", 2), team("a", 0), team("b", 1)]);
    expect(out.map((g) => g.team.id)).toEqual(["a", "b", "c"]);
    expect(out[1].matches).toEqual([bc, ab].sort((x, y) => x.queue_order - y.queue_order));
    expect(out[0].matches).toEqual([ab]);
  });
});

describe("roundText", () => {
  it("navngir gruppe, runde og sluttspill", () => {
    const sf = match({ phase: "playoff", round: 2, bracket_slot: 0 });
    const f = match({ phase: "playoff", round: 3, bracket_slot: 0 });
    const bronze = match({ phase: "playoff", round: 3, bracket_slot: 1 });
    const total = playoffRounds([sf, f, bronze]);
    expect(total).toBe(3);
    expect(roundText(f, total)).toBe("Finale");
    expect(roundText(sf, total)).toBe("Semifinale");
    expect(roundText(bronze, total)).toBe("Bronsefinale");
    expect(roundText(match({ group_no: 1, round: 2 }), 0)).toBe("Gruppe B · Runde 2");
    expect(roundText(match({ round: 4 }), 0)).toBe("Runde 4");
  });
});

describe("scoreBoxes", () => {
  it("velger ruter etter poengprofil", () => {
    expect(scoreBoxes({ profile: "simple" })).toEqual({ kind: "simple" });
    expect(scoreBoxes({ profile: "winner" })).toEqual({ kind: "winner" });
    expect(scoreBoxes({ profile: "sets", setsBestOf: 5 })).toEqual({ kind: "sets", sets: 5 });
    expect(scoreBoxes({ profile: "sets" })).toEqual({ kind: "sets", sets: 3 });
    expect(scoreBoxes({ profile: "sets", setsBestOf: 99 })).toEqual({ kind: "sets", sets: 3 });
  });
});

describe("QR-lenker", () => {
  it("bygger kontroll-URL med kode og kamp/bane", () => {
    expect(controlMatchUrl("https://x.app", "123456", "m-1")).toBe(
      "https://x.app/kontroll?code=123456&match=m-1",
    );
    expect(controlCourtUrl("https://x.app", "123456", "c-1")).toBe(
      "https://x.app/kontroll?code=123456&court=c-1",
    );
  });

  it("kan leses tilbake av parseControlTarget", () => {
    const url = new URL(controlMatchUrl("https://x.app", "123456", "abcd1234-ef"));
    expect(parseControlTarget(url.searchParams)).toEqual({ match: "abcd1234-ef", court: null });
  });
});

describe("controlTarget", () => {
  it("avviser ugyldige id-er og tomme parametre", () => {
    expect(parseControlTarget("?match=<script>&court=x")).toEqual({ match: null, court: null });
    expect(parseControlTarget("")).toEqual({ match: null, court: null });
  });

  it("withControlTarget beholder stien uten mål", () => {
    expect(withControlTarget("/kontroll/t1", { match: null, court: null })).toBe("/kontroll/t1");
    expect(withControlTarget("/kontroll/t1", { match: "m1abcdef", court: null })).toBe(
      "/kontroll/t1?match=m1abcdef",
    );
  });

  it("resolveControlTarget: åpne kamp, feste bane, og feiltilfellene", () => {
    const ready = match();
    const done = match({ status: "done" });
    const tbd = match({ away_team_id: null });
    const ms = [ready, done, tbd];
    const t = (p: Partial<{ match: string; court: string }>) => ({
      match: p.match ?? null,
      court: p.court ?? null,
    });
    expect(resolveControlTarget(t({}), ms, courts)).toBeNull();
    expect(resolveControlTarget(t({ match: ready.id }), ms, courts)).toEqual({
      kind: "openMatch",
      match: ready,
    });
    expect(resolveControlTarget(t({ match: done.id }), ms, courts)).toEqual({ kind: "matchDone" });
    expect(resolveControlTarget(t({ match: tbd.id }), ms, courts)).toEqual({ kind: "matchNotReady" });
    expect(resolveControlTarget(t({ match: "finnes-ikke" }), ms, courts)).toEqual({ kind: "missing" });
    expect(resolveControlTarget(t({ court: "c1" }), ms, courts)).toEqual({
      kind: "pinCourt",
      courtId: "c1",
    });
    expect(resolveControlTarget(t({ court: "c9" }), ms, courts)).toEqual({ kind: "missing" });
  });
});
