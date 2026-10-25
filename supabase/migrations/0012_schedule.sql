-- Tidsplan med klokkeslett (A1). Hver kamp får et planlagt starttidspunkt.
-- Selve oppsettet (start, kampvarighet, pause, hvile, banepauser) ligger i
-- tournaments.config.schedule (jsonb) — ingen kolonne trengs der. Additiv og
-- nullable: eksisterende turneringer og all dagens kode er uendret (null =
-- ingen tidsplan).

alter table turnering.matches
  add column if not exists scheduled_at timestamptz;
