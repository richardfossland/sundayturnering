"use client";

import { useEffect, useState } from "react";
import { myTournaments } from "./myTournaments";
import { SiteHeader, backToHome } from "./SiteHeader";
import { no } from "@/lib/locale/no";

// Header for the organiser's sub-pages (resultat, skriv-ut): "back" goes to
// Kontrollsenteret when this device owns the tournament, else to forsiden.
export function OrganiserHeader({ id }: { id: string }) {
  const [mine, setMine] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read device storage post-mount
    setMine(myTournaments.get(id) !== null);
  }, [id]);
  return (
    <SiteHeader back={mine ? { href: `/arrangor/${id}`, label: no.hub.eyebrow } : backToHome} />
  );
}
