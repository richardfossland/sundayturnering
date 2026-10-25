-- 0018: Swiss-system (format 'swiss'). Additiv og idempotent. Ingen triggere.
--
-- tournaments.format godtar 'swiss' (CHECK fra 0017 bygges på nytt). Swiss bruker
-- bare eksisterende tabeller: kampene er vanlige ligakamper (phase 'league') med
-- `round` = rundenummer, lagt til én runde om gangen av appen. Antall runder
-- ligger i tournaments.config.swiss.rounds (jsonb). Ingen RPC-endringer.
-- Må kjøres FØR appversjonen som bygger Swiss-turneringer deployes.

alter table turnering.tournaments
  drop constraint if exists tournaments_format_check;
alter table turnering.tournaments
  add constraint tournaments_format_check
  check (format in ('league', 'league_playoff', 'cup', 'group_playoff', 'double_elim', 'swiss'));
