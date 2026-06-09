import { ok, fail, readJson, rateLimit, clientIp } from "@/lib/server/http";
import {
  getTournamentByControlCode,
  getTournamentByBoardCode,
} from "@/lib/server/store";
import { toTournamentDTO } from "@/lib/dto";
import { isValidControlCode, normalizeWordCode } from "@/lib/codes";

// POST /api/attach — a control device (control_code) or a reopened board
// (board_code) resolves a tournament id. Returns the public tournament DTO.
export async function POST(req: Request) {
  if (!rateLimit(`attach:${clientIp(req)}`, 30, 60_000))
    return fail(429, "for_mange_forsok");

  const body = await readJson<{ controlCode?: string; boardCode?: string }>(req);
  if (!body) return fail(400, "ugyldig_body");

  if (typeof body.controlCode === "string") {
    const code = body.controlCode.trim();
    if (!isValidControlCode(code)) return fail(400, "ugyldig_kode");
    const t = await getTournamentByControlCode(code);
    if (!t) return fail(404, "finnes_ikke");
    return ok({ tournament: toTournamentDTO(t) });
  }

  if (typeof body.boardCode === "string") {
    const t = await getTournamentByBoardCode(normalizeWordCode(body.boardCode));
    if (!t) return fail(404, "finnes_ikke");
    return ok({ tournament: toTournamentDTO(t) });
  }

  return fail(400, "mangler_kode");
}
