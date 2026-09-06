"use client";

import { useEffect, useState } from "react";
import { acquireChannel } from "@/lib/client/channelRegistry";
import { channels } from "@/lib/realtime";

export interface PresenceDevice {
  deviceId: string;
  name: string;
}

/** Track which control devices are attached to a tournament via Supabase
 * Presence (spec §1, §5). Returns the current roster. Goes through the shared
 * channel registry so the presence channel is re-tracked after a reconnect
 * instead of silently dropping this device from everyone's roster. */
export function usePresence(
  tournamentId: string | null,
  self: PresenceDevice | null,
): PresenceDevice[] {
  const [devices, setDevices] = useState<PresenceDevice[]>([]);
  const deviceId = self?.deviceId;
  const name = self?.name;

  useEffect(() => {
    if (!tournamentId || !deviceId) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const { release } = acquireChannel(channels.presence(tournamentId), {
      track: { key: deviceId, payload: { deviceId, name: name ?? "" } },
      onPresence: (state) => {
        const list: PresenceDevice[] = [];
        for (const key of Object.keys(state)) {
          const meta = state[key][0];
          if (meta) list.push({ deviceId: key, name: String(meta.name ?? "") });
        }
        setDevices(list);
      },
    });
    return release;
  }, [tournamentId, deviceId, name]);

  return devices;
}
