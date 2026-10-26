import "server-only";

import { propagateResult } from "@/lib/server/playoff";
import type { Match } from "@/lib/types";

/** Run the bracket propagation for a result that has ALREADY committed, with one
 * retry: the RPC is idempotent per (match, result_version), so a second attempt
 * after a transient DB/network hiccup is safe and usually succeeds. Never
 * throws — a false return means the next match was NOT updated and the referee
 * must be told (response flag `propagated: false`). */
export async function propagateAfterCommit(
  saved: Match | null | undefined,
  tag: string,
): Promise<boolean> {
  if (saved?.phase !== "playoff") return true;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await propagateResult(saved);
      return true;
    } catch (e) {
      console.error(`[${tag}] propagate failed after commit (attempt ${attempt + 1})`, e);
    }
  }
  return false;
}
