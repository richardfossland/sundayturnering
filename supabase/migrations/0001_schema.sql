-- SundayTurnering schema (spec §2). Lives in a dedicated `turnering` Postgres
-- schema so it can coexist with SundayChess in the same project without table
-- clashes. RLS is enabled on every table with NO anon/authenticated policies:
-- clients never touch tables directly. All reads/writes go through server API
-- routes using the service role (which bypasses RLS). (spec §8)

create schema if not exists turnering;

create or replace function turnering.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- tournaments ----------
create table turnering.tournaments (
  id             uuid primary key default gen_random_uuid(),
  control_code   text not null unique,            -- 6 digits, control devices enter
  board_code     text not null,                   -- reopen the board view later
  organiser_code text not null,                   -- gates destructive actions
  organiser_id   uuid,                            -- optional Supabase auth user
  title          text not null default '',
  sport_label    text not null default '',
  format         text not null
                   check (format in ('league','league_playoff','cup')),
  scoring        jsonb not null default '{}'::jsonb,
  parallelism    text not null default 'sequential'
                   check (parallelism in ('sequential','parallel')),
  config         jsonb not null default '{}'::jsonb,
  status         text not null default 'setup'
                   check (status in ('setup','league','playoff','finished')),
  version        int not null default 0,          -- bumped on structural change
  created_at     timestamptz not null default now()
);
create index tournaments_control_code_idx on turnering.tournaments (control_code);

-- ---------- courts ----------
create table turnering.courts (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references turnering.tournaments (id) on delete cascade,
  name          text not null,
  sort_order    int not null default 0
);
create index courts_tournament_idx on turnering.courts (tournament_id);

-- ---------- teams ----------
create table turnering.teams (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references turnering.tournaments (id) on delete cascade,
  name          text not null,
  colour        text not null default '#888888',
  logo_url      text,
  seed          int,
  sort_order    int not null default 0
);
create index teams_tournament_idx on turnering.teams (tournament_id);

-- ---------- matches ----------
create table turnering.matches (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references turnering.tournaments (id) on delete cascade,
  phase          text not null default 'league'
                   check (phase in ('league','playoff')),
  round          int not null default 1,
  bracket_slot   int,
  court_id       uuid references turnering.courts (id) on delete set null,
  queue_order    int not null default 0,
  home_team_id   uuid references turnering.teams (id) on delete cascade,
  away_team_id   uuid references turnering.teams (id) on delete cascade,  -- null = bye/TBD
  status         text not null default 'scheduled'
                   check (status in ('scheduled','live','done','bye')),
  result         jsonb,
  winner_team_id uuid references turnering.teams (id) on delete set null,
  locked_by      text,                            -- control deviceId editing (soft lock)
  result_version int not null default 0,          -- optimistic concurrency guard
  updated_at     timestamptz not null default now()
);
create index matches_tournament_idx on turnering.matches (tournament_id);
create index matches_queue_idx on turnering.matches (tournament_id, queue_order);
create index matches_court_idx on turnering.matches (court_id);

create trigger matches_set_updated_at
  before update on turnering.matches
  for each row execute function turnering.set_updated_at();

-- ---------- bracket_links (winner flow for playoff/cup) ----------
create table turnering.bracket_links (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references turnering.tournaments (id) on delete cascade,
  from_match_id uuid not null references turnering.matches (id) on delete cascade,
  to_match_id   uuid not null references turnering.matches (id) on delete cascade,
  to_slot       text not null check (to_slot in ('home','away'))
);
create index bracket_links_from_idx on turnering.bracket_links (from_match_id);
create index bracket_links_tournament_idx on turnering.bracket_links (tournament_id);

-- ---------- RLS: lock everything to the service role ----------
alter table turnering.tournaments   enable row level security;
alter table turnering.courts        enable row level security;
alter table turnering.teams         enable row level security;
alter table turnering.matches       enable row level security;
alter table turnering.bracket_links enable row level security;
-- No policies on purpose → anon/authenticated get zero direct access.

-- Expose the schema to PostgREST roles (REST/RPC routing). RLS still governs
-- row access; service_role bypasses it.
grant usage on schema turnering to anon, authenticated, service_role;
grant all on all tables in schema turnering to service_role;
grant execute on all functions in schema turnering to service_role;
alter default privileges in schema turnering grant all on tables to service_role;

-- ---------- Storage bucket for team logos (public read; project-global) ----------
insert into storage.buckets (id, name, public)
  values ('team-logos', 'team-logos', true)
  on conflict (id) do nothing;
