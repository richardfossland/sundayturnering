import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the service-role client with a tiny chainable that records the query so
// we can assert listTournamentsByOrganiser filters on organiser_id, orders by
// created_at desc, and returns the rows the DB hands back.
const calls: {
  table?: string;
  select?: string;
  eqCol?: string;
  eqVal?: string;
  orderCol?: string;
  orderAsc?: boolean;
} = {};
let returnedRows: unknown[] = [];

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from(table: string) {
      calls.table = table;
      return {
        select(sel: string) {
          calls.select = sel;
          return this;
        },
        eq(col: string, val: string) {
          calls.eqCol = col;
          calls.eqVal = val;
          return this;
        },
        order(col: string, opts: { ascending: boolean }) {
          calls.orderCol = col;
          calls.orderAsc = opts.ascending;
          return Promise.resolve({ data: returnedRows, error: null });
        },
      };
    },
  }),
}));

import { listTournamentsByOrganiser } from "@/lib/server/store";

describe("listTournamentsByOrganiser", () => {
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete (calls as Record<string, unknown>)[k];
    returnedRows = [];
  });

  it("queries tournaments filtered by organiser_id, newest first", async () => {
    const rows = [
      { id: "a", title: "A", sport_label: "", format: "cup", status: "playoff", control_code: "1", board_code: "x", created_at: "2026-01-02" },
      { id: "b", title: "B", sport_label: "", format: "league", status: "league", control_code: "2", board_code: "y", created_at: "2026-01-01" },
    ];
    returnedRows = rows;

    const out = await listTournamentsByOrganiser("uid-7");

    expect(calls.table).toBe("tournaments");
    expect(calls.eqCol).toBe("organiser_id");
    expect(calls.eqVal).toBe("uid-7");
    expect(calls.orderCol).toBe("created_at");
    expect(calls.orderAsc).toBe(false);
    // does not request organiser_code (secret stays out of the list)
    expect(calls.select).not.toContain("organiser_code");
    expect(out).toEqual(rows);
  });

  it("returns [] when the DB returns no data", async () => {
    returnedRows = null as unknown as unknown[];
    const out = await listTournamentsByOrganiser("uid-none");
    expect(out).toEqual([]);
  });
});
