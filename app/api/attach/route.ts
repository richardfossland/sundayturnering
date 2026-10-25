import { ok, fail, readJson, rateLimit, clientIp, withApi } from "@/lib/server/http";
import {
  getTournamentByControlCode,
  getTournamentByBoardCode,
} from "@/lib/server/store";
import { isCodeBlocked, registerCodeFailure } from "@/lib/server/attempts";
import { toAttachedTournamentDTO } from "@/lib/dto";
import { isValidControlCode, normalizeWordCode } from "@/lib/codes";

// POST /api/attach — a control device (control_code) or a reopened board
// (board_code) resolves a tournament id. Returns the public tournament DTO plus
// the codes that device is entitled to (see toAttachedTournamentDTO).
async function handlePOST(req: Request) {
  if (!rateLimit(`attach:${clientIp(req)}`, 300, 60_000))
    return fail(429, "for_mange_forsok");

  const body = await readJson<{ controlCode?: string; boardCode?: string }>(req);
  if (!body) return fail(400, "ugyldig_body");
  // Shared-IP-safe guess protection: only NOT-FOUND lookups count (a hall of
  // phones attaching with the right code is never blocked). Fails open.
  if (await isCodeBlocked("attach", req)) return fail(429, "for_mange_forsok");
  const miss = async () =>
    (await registerCodeFailure("attach", req))
      ? fail(429, "for_mange_forsok")
      : fail(404, "finnes_ikke");

  if (typeof body.controlCode === "string") {
    const code = body.controlCode.trim();
    if (!isValidControlCode(code)) return fail(400, "ugyldig_kode");
    const t = await getTournamentByControlCode(code);
    if (!t) return miss();
    return ok({ tournament: toAttachedTournamentDTO(t, "control") });
  }

  if (typeof body.boardCode === "string") {
    const t = await getTournamentByBoardCode(normalizeWordCode(body.boardCode));
    if (!t) return miss();
    return ok({ tournament: toAttachedTournamentDTO(t, "board") });
  }

  return fail(400, "mangler_kode");
}

export const POST = withApi(handlePOST);
