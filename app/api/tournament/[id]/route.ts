import { ok, fail } from "@/lib/server/http";
import { getTournament, getState } from "@/lib/server/store";

// GET /api/tournament/[id] — full state for board + control to render.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const t = await getTournament(id);
  if (!t) return fail(404, "finnes_ikke");
  const state = await getState(t);
  return ok(state, {
    headers: { "Cache-Control": "no-store" },
  });
}
