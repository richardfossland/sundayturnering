-- SundayTurnering schema (spec §2). Code-identity (no tenancy).
-- RLS is enabled on every table with NO anon/authenticated policies: clients
-- never touch tables directly. All reads/writes go through server API routes
-- using the service role (which bypasses RLS). Realtime broadcast/presence is
-- channel-authorised separately and carries no table data. (spec §8)

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- tournaments ----------
create table public.tournaments (
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
create index tournaments_control_code_idx on public.tournaments (control_code);

-- ---------- courts ----------
create table public.courts (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name          text not null,
  sort_order    int not null default 0
);
create index courts_tournament_idx on public.courts (tournament_id);

-- ---------- teams ----------
create table public.teams (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name          text not null,
  colour        text not null default '#888888',
  logo_url      text,
  seed          int,
  sort_order    int not null default 0
);
create index teams_tournament_idx on public.teams (tournament_id);

-- ---------- matches ----------
create table public.matches (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references public.tournaments (id) on delete cascade,
  phase          text not null default 'league'
                   check (phase in ('league','playoff')),
  round          int not null default 1,
  bracket_slot   int,
  court_id       uuid references public.courts (id) on delete set null,
  queue_order    int not null default 0,
  home_team_id   uuid references public.teams (id) on delete cascade,
  away_team_id   uuid references public.teams (id) on delete cascade,  -- null = bye/TBD
  status         text not null default 'scheduled'
                   check (status in ('scheduled','live','done','bye')),
  result         jsonb,
  winner_team_id uuid references public.teams (id) on delete set null,
  locked_by      text,                            -- control deviceId editing (soft lock)
  result_version int not null default 0,          -- optimistic concurrency guard
  updated_at     timestamptz not null default now()
);
create index matches_tournament_idx on public.matches (tournament_id);
create index matches_queue_idx on public.matches (tournament_id, queue_order);
create index matches_court_idx on public.matches (court_id);

create trigger matches_set_updated_at
  before update on public.matches
  for each row execute function public.set_updated_at();

-- ---------- bracket_links (winner flow for playoff/cup) ----------
create table public.bracket_links (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  from_match_id uuid not null references public.matches (id) on delete cascade,
  to_match_id   uuid not null references public.matches (id) on delete cascade,
  to_slot       text not null check (to_slot in ('home','away'))
);
create index bracket_links_from_idx on public.bracket_links (from_match_id);
create index bracket_links_tournament_idx on public.bracket_links (tournament_id);

-- ---------- RLS: lock everything to the service role ----------
alter table public.tournaments   enable row level security;
alter table public.courts        enable row level security;
alter table public.teams         enable row level security;
alter table public.matches       enable row level security;
alter table public.bracket_links enable row level security;
-- No policies on purpose → anon/authenticated get zero direct access.
-- The service-role key used by the API routes bypasses RLS entirely.

-- ---------- Storage bucket for team logos (public read) ----------
insert into storage.buckets (id, name, public)
  values ('team-logos', 'team-logos', true)
  on conflict (id) do nothing;
