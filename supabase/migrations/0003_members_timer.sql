-- Team rosters (for the random draw feature) + an optional match timer on the
-- tournament (shown on the board). Additive, safe to re-run.

alter table turnering.teams
  add column if not exists members jsonb not null default '[]'::jsonb;

alter table turnering.tournaments
  add column if not exists timer jsonb;
