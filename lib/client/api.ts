"use client";

import type { StateDTO, TournamentDTO } from "@/lib/dto";
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
  ) {
    super(code);
  }
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
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(res.status, json.error ?? "feil", json.detail);
  return json as T;
}

export const api = {
  async fetchState(id: string): Promise<StateDTO> {
    const res = await fetch(`/api/tournament/${id}`, { cache: "no-store" });
    if (!res.ok) throw new ApiError(res.status, "kunne_ikke_hente");
    return (await res.json()) as StateDTO;
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
    return post<{ tournament: TournamentDTO }>("/api/attach", { controlCode });
  },
  attachBoard(boardCode: string) {
    return post<{ tournament: TournamentDTO }>("/api/attach", { boardCode });
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

  advance(tournamentId: string, organiserCode: string) {
    return post<{ ok: true }>("/api/organiser/advance", {
      tournamentId,
      organiserCode,
    });
  },
  override(
    tournamentId: string,
    organiserCode: string,
    matchId: string,
    result: MatchResult,
  ) {
    return post<{ match: Match }>("/api/organiser/override", {
      tournamentId,
      organiserCode,
      matchId,
      result,
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
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json.error ?? "feil");
    return json.url as string;
  },

  // ---- Sunday Account admin (session-gated; no organiser code needed) ----
  async listMyTournaments(): Promise<OrganiserTournamentRow[]> {
    const res = await fetch("/api/admin/tournaments", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
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
