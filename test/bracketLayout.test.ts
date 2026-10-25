import { describe, it, expect } from "vitest";
import { buildBracket } from "@/lib/tournament/bracket";
import {
  inferLinks,
  layoutBracket,
  layoutBrackets,
  roundName,
  type LayoutLink,
  type LayoutMatch,
} from "@/lib/tournament/bracketLayout";

function seeds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `s${i + 1}`);
}

/** Bygg layout-input fra den ekte bygger-en, med ids `r{round}s{slot}`. */
function fromBuilder(n: number, thirdPlace = false) {
  const b = buildBracket(seeds(n), { thirdPlace });
  const id = (r: number, s: number) => `r${r}s${s}`;
  const matches: LayoutMatch[] = b.matches.map((m) => ({
    id: id(m.round, m.slot),
    round: m.round,
    bracket_slot: m.slot,
  }));
  const links: LayoutLink[] = b.links.map((l) => ({
    from_match_id: id(l.fromRound, l.fromSlot),
    to_match_id: id(l.toRound, l.toSlot),
    to_slot: l.toSide,
    feed: l.feed,
  }));
  return { id: "A", label: "A", matches, links };
}

describe("roundName", () => {
  it("navn fra finalen og bakover", () => {
    expect(roundName(3, 4)).toBe("Finale");
    expect(roundName(2, 4)).toBe("Semifinale");
    expect(roundName(1, 4)).toBe("Kvartfinale");
    expect(roundName(0, 4)).toBe("Åttedelsfinale");
    expect(roundName(0, 5)).toBe("Runde 1");
  });
});

describe("layoutBracket", () => {
  it.each([4, 8, 16])("%i lag: runder, kamper og midtstilling", (n) => {
    const l = layoutBracket(fromBuilder(n));
    expect(l.rounds).toHaveLength(Math.log2(n));
    expect(l.rounds[0].nodes).toHaveLength(n / 2);
    expect(l.rounds.at(-1)!.name).toBe("Finale");
    expect(l.height).toBe(n / 2);
    // hver kamp midt mellom sine to matere
    for (const r of l.rounds.slice(1))
      for (const node of r.nodes) {
        const feeders = l.connectors.filter((c) => c.toId === node.id);
        expect(feeders).toHaveLength(2);
        expect(node.y).toBe((feeders[0].fromY + feeders[1].fromY) / 2);
      }
  });

  it("8 lag: koder og opprinnelsesetiketter", () => {
    const l = layoutBracket(fromBuilder(8));
    expect(l.rounds[0].nodes.map((x) => x.code)).toEqual(["KF1", "KF2", "KF3", "KF4"]);
    expect(l.rounds[1].nodes.map((x) => x.code)).toEqual(["SF1", "SF2"]);
    const fin = l.rounds[2].nodes[0];
    expect(fin.code).toBe("F");
    expect(fin.home?.label).toBe("Vinner av SF1");
    expect(fin.away?.label).toBe("Vinner av SF2");
    expect(l.rounds[1].nodes[0].home?.label).toBe("Vinner av KF1");
    expect(l.rounds[0].nodes[0].home).toBeNull();
  });

  it("posisjoner er monotone innen hver kolonne", () => {
    for (const n of [4, 5, 6, 7, 8, 11, 16]) {
      const l = layoutBracket(fromBuilder(n));
      for (const r of l.rounds)
        for (let i = 1; i < r.nodes.length; i++)
          expect(r.nodes[i].y).toBeGreaterThanOrEqual(r.nodes[i - 1].y + 1);
    }
  });

  it.each([5, 6, 7])("%i lag (byes): 3 runder, alle kamper med", (n) => {
    const l = layoutBracket(fromBuilder(n));
    expect(l.rounds).toHaveLength(3);
    expect(l.rounds.flatMap((r) => r.nodes)).toHaveLength(7);
    expect(l.connectors).toHaveLength(6);
  });

  it("bronsefinale blir egen ekstra-kamp, ikke kolonne eller linje", () => {
    const l = layoutBracket(fromBuilder(8, true));
    expect(l.rounds).toHaveLength(3);
    expect(l.rounds[2].nodes).toHaveLength(1);
    expect(l.extras).toHaveLength(1);
    expect(l.extras[0].code).toBe("BF");
    expect(l.extras[0].home?.label).toBe("Taper av SF1");
    expect(l.extras[0].away?.label).toBe("Taper av SF2");
    expect(l.connectors.some((c) => c.toId === l.extras[0].id)).toBe(false);
  });

  it("uten lenker: inferLinks gir samme tre som bygger-en", () => {
    const full = fromBuilder(8, true);
    const inferred = inferLinks(full.matches);
    const key = (x: LayoutLink) =>
      `${x.from_match_id}>${x.to_match_id}:${x.to_slot}:${x.feed}`;
    expect(inferred.map(key).sort()).toEqual(full.links.map(key).sort());
    expect(layoutBracket({ ...full, links: inferred })).toEqual(layoutBracket(full));
  });

  it("2 lag er bare en finale", () => {
    const l = layoutBracket(fromBuilder(2));
    expect(l.rounds).toHaveLength(1);
    expect(l.rounds[0].nodes[0].code).toBe("F");
    expect(l.connectors).toHaveLength(0);
  });

  it("flere braketter får hver sin uavhengige layout", () => {
    const a = fromBuilder(8);
    const bRaw = fromBuilder(4);
    const pre = (x: string) => `B-${x}`;
    const b = {
      id: "B",
      label: "B-sluttspill",
      matches: bRaw.matches.map((m) => ({ ...m, id: pre(m.id) })),
      links: bRaw.links.map((x) => ({
        ...x,
        from_match_id: pre(x.from_match_id),
        to_match_id: pre(x.to_match_id),
      })),
    };
    const [la, lb] = layoutBrackets([a, b]);
    expect(la.id).toBe("A");
    expect(lb.id).toBe("B");
    expect(lb.label).toBe("B-sluttspill");
    expect(la.rounds).toHaveLength(3);
    expect(lb.rounds).toHaveLength(2);
    expect(lb.rounds[1].nodes[0].home?.label).toBe("Vinner av SF1");
  });
});
