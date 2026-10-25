"use client";

import type { AttachedTournamentDTO, StateDTO } from "@/lib/dto";
import type { Match, MatchResult } from "@/lib/types";
import type { CreateInput } from "@/lib/server/build";
import type { OrganiserTournamentRow } from "@/lib/server/store";

// Typed fetch wrappers for the API routes. Throw ApiError on non-2xx so callers
// can branch on the error code (e.g. 'konflikt' → refetch + warn).

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail?: string,
    /** Any other fields of the error body (e.g. `count` on a 409). */
    public data?: Record<string, unknown>,
  ) {
    super(code);
  }
}

// A half-open connection (flaky venue wifi) never errors — fetch just hangs,
// the Refetcher's in-flight slot stays taken and the projector board freezes
// silently. So every call is bounded, and the bound covers the BODY read too
// (headers can arrive and the body still stall).
let timeoutMs = 8000;
/** Test seam: shrink the bound so a hang can be proven without waiting 8 s. */
export function __setFetchTimeout(ms: number): void {
  timeoutMs = ms;
}

type JsonBody = { error?: string; detail?: string; [k: string]: unknown };

/** fetch + res.json() under one timeout. Resolves { res, json } (json = {} when
 * the body is not JSON); a timeout throws ApiError(0, "tidsavbrudd"). Other
 * errors (network down → TypeError) propagate unchanged. */
async function fetchJson(
  input: string,
  init?: RequestInit,
): Promise<{ res: Response; json: JsonBody }> {
  try {
    const res = await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const json = await res.json().catch((e) => {
      // A stalled body aborts here — that must NOT be swallowed as "not JSON".
      if (isAbort(e)) throw e;
      return {};
    });
    return { res, json };
  } catch (e) {
    if (isAbort(e)) throw new ApiError(0, "tidsavbrudd");
    throw e;
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return send<T>("POST", path, body);
}

/** Shared fetch for non-GET verbs (POST/PATCH/DELETE). Body is optional. */
async function send<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const { res, json } = await fetchJson(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok)
    throw new ApiError(res.status, json.error ?? "feil", json.detail, json);
  return json as T;
}

export const api = {
  async fetchState(id: string): Promise<StateDTO> {
    const { res, json } = await fetchJson(`/api/tournament/${id}`, { cache: "no-store" });
    if (!res.ok) throw new ApiError(res.status, "kunne_ikke_hente");
    return json as unknown as StateDTO;
  },

  create(input: CreateInput) {
    return post<{
      id: string;
      control_code: string;
      board_code: string;
      organiser_code: string;
    }>("/api/tournament", input);
  },

  attachControl(controlCode: string) {
    return post<{ tournament: AttachedTournamentDTO }>("/api/attach", { controlCode });
  },
  attachBoard(boardCode: string) {
    return post<{ tournament: AttachedTournamentDTO }>("/api/attach", { boardCode });
  },

  // ---- referee routes: every one carries the control code (the referee
  // credential — match/tournament ids are public). 403 feil_kontrollkode means
  // the stored code is wrong/stale and the control page must re-prompt. ----
  /** `promoted` (lock/force response) = this call moved the match to live;
   * pass it back as `opts.revert` on unlock so a match started with "Start
   * kamp" is not demoted when the result modal merely opens and closes. */
  lock(
    matchId: string,
    deviceId: string,
    deviceName: string,
    action: "lock" | "force" | "unlock" | "start",
    controlCode: string,
    opts?: { revert?: boolean },
  ) {
    return post<{ match: Match; promoted?: boolean }>("/api/match/lock", {
      matchId,
      deviceId,
      deviceName,
      action,
      controlCode,
      revert: opts?.revert,
    });
  },

  submitResult(
    matchId: string,
    expectedVersion: number,
    result: MatchResult,
    device: { deviceId: string; deviceName?: string },
    controlCode: string,
  ) {
    return post<{ match: Match }>("/api/match/result", {
      matchId,
      expectedVersion,
      result,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      controlCode,
    });
  },

  /** Interim score pushed to the board while the match is live (not a result;
   * the final save still goes through submitResult). */
  liveScore(
    matchId: string,
    result: MatchResult,
    device: { deviceId: string },
    controlCode: string,
  ) {
    return post<{ ok: true; result: MatchResult }>("/api/match/live", {
      matchId,
      result,
      deviceId: device.deviceId,
      controlCode,
    });
  },

  /** Referee self-correct of their own just-saved result (grace window). */
  correct(
    matchId: string,
    expectedVersion: number,
    result: MatchResult,
    device: { deviceId: string; deviceName?: string },
    controlCode: string,
  ) {
    return post<{ match: Match }>("/api/match/correct", {
      matchId,
      expectedVersion,
      result,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      controlCode,
    });
  },

  /** Referee-controlled match/court timer (non-destructive, not organiser-gated). */
  courtTimer(
    tournamentId: string,
    action: "start" | "add" | "stop",
    controlCode: string,
    opts?: { courtId?: string; durationSec?: number },
  ) {
    return post<{ timer: unknown }>("/api/match/timer", {
      tournamentId,
      action,
      controlCode,
      courtId: opts?.courtId,
      durationSec: opts?.durationSec,
    });
  },

  /** 409 `uspilte_kamper` (data.count) until `force` confirms seeding from an
   * unfinished table. */
  advance(tournamentId: string, organiserCode: string, opts?: { force?: boolean }) {
    return post<{ ok: true }>("/api/organiser/advance", {
      tournamentId,
      organiserCode,
      force: opts?.force,
    });
  },
  /** 409 `neste_kamp_spilt` (data.count) when a knockout winner changes after
   * later rounds were played; `cascade` confirms resetting them. */
  override(
    tournamentId: string,
    organiserCode: string,
    matchId: string,
    result: MatchResult,
    opts?: { cascade?: boolean },
  ) {
    return post<{ match: Match }>("/api/organiser/override", {
      tournamentId,
      organiserCode,
      matchId,
      result,
      cascade: opts?.cascade,
    });
  },
  reopen(tournamentId: string, organiserCode: string) {
    return post<{ ok: true; status: string }>("/api/organiser/reopen", {
      tournamentId,
      organiserCode,
    });
  },
  finish(tournamentId: string, organiserCode: string) {
    return post<{ ok: true }>("/api/organiser/finish", {
      tournamentId,
      organiserCode,
    });
  },
  timer(
    tournamentId: string,
    organiserCode: string,
    action: "start" | "add" | "stop",
    durationSec?: number,
  ) {
    return post<{ timer: unknown }>("/api/organiser/timer", {
      tournamentId,
      organiserCode,
      action,
      durationSec,
    });
  },

  async uploadLogo(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    const { res, json } = await fetchJson("/api/upload", { method: "POST", body: fd });
    if (!res.ok) throw new ApiError(res.status, json.error ?? "feil");
    return json.url as string;
  },

  // ---- Sunday Account admin (session-gated; no organiser code needed) ----
  async listMyTournaments(): Promise<OrganiserTournamentRow[]> {
    const { res, json } = await fetchJson("/api/admin/tournaments", { cache: "no-store" });
    if (!res.ok) throw new ApiError(res.status, json.error ?? "feil");
    return (json.tournaments ?? []) as OrganiserTournamentRow[];
  },
  deleteTournament(id: string) {
    return send<{ ok: true }>("DELETE", `/api/tournament/${id}`);
  },
  editTournament(id: string, patch: { title?: string; sport_label?: string }) {
    return send<{ ok: true }>("PATCH", `/api/admin/tournaments/${id}`, patch);
  },
  reopenTournament(id: string) {
    return send<{ ok: true; status: string }>(
      "POST",
      `/api/admin/tournaments/${id}/reopen`,
    );
  },
};
