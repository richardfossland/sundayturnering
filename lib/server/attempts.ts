import "server-only";

import { db } from "@/lib/server/store";
import { clientIp } from "@/lib/server/http";

// DB-backed wrong-code counter (migration 0010). A school hall puts 30 phones
// behind ONE public IP, so only FAILED code guesses count — correct phones are
// never throttled by this. 20 failures / 10 min per (scope, IP) blocks that IP
// for the scope. `scope` = tournament id (control code), `org:<id>` (organiser
// code) or `attach` (control-code lookup with no tournament known yet).
//
// FAIL OPEN: if the RPC errors (outage, migration not applied yet) we log and
// carry on — this limiter must never take an event down.

export const CODE_WINDOW_S = 600;
export const CODE_MAX_FAILURES = 20;

export async function isCodeBlocked(scope: string, req: Request): Promise<boolean> {
  try {
    const { data, error } = await db().rpc("code_blocked", {
      p_scope: scope,
      p_ip: clientIp(req),
      p_window_s: CODE_WINDOW_S,
      p_max: CODE_MAX_FAILURES,
    });
    if (error) throw error;
    return data === true;
  } catch (e) {
    console.error("[code_blocked] fail-open", e);
    return false;
  }
}

/** Record one wrong guess. Returns true when the IP is now blocked. */
export async function registerCodeFailure(scope: string, req: Request): Promise<boolean> {
  try {
    const { data, error } = await db().rpc("register_code_failure", {
      p_scope: scope,
      p_ip: clientIp(req),
      p_window_s: CODE_WINDOW_S,
      p_max: CODE_MAX_FAILURES,
    });
    if (error) throw error;
    return data === true;
  } catch (e) {
    console.error("[register_code_failure] fail-open", e);
    return false;
  }
}
