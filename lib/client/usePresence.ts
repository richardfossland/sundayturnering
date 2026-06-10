"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { channels } from "@/lib/realtime";

export interface PresenceDevice {
  deviceId: string;
  name: string;
}

/** Track which control devices are attached to a tournament via Supabase
 * Presence (spec §1, §5). Returns the current roster. */
export function usePresence(
  tournamentId: string | null,
  self: PresenceDevice | null,
): PresenceDevice[] {
  const [devices, setDevices] = useState<PresenceDevice[]>([]);

  useEffect(() => {
    if (!tournamentId || !self) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const supabase = createClient();
    const channel = supabase.channel(channels.presence(tournamentId), {
      config: { presence: { key: self.deviceId } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const st = channel.presenceState<PresenceDevice>();
      const list: PresenceDevice[] = [];
      for (const key of Object.keys(st)) {
        const meta = st[key][0];
        if (meta) list.push({ deviceId: key, name: meta.name });
      }
      setDevices(list);
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED")
        channel.track({ deviceId: self.deviceId, name: self.name });
    });

    return () => {
      // Untrack before removing so other devices drop us immediately instead of
      // waiting for the presence record to expire (~no ghost entries).
      channel.untrack().catch(() => {});
      supabase.removeChannel(channel);
    };
  }, [tournamentId, self?.deviceId, self?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  return devices;
}
