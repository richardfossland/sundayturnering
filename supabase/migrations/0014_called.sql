-- 0014: oppkalling (A3). A match can be CALLED to a court before it starts:
-- status 'called' + called_at. Additive and idempotent. No triggers.
-- Conventions copied from 0010/0013: plpgsql, search_path pinned, execute
-- granted to service_role only.
--
-- MUST be applied in prod BEFORE the app version that calls it is deployed
-- (app/api/organiser/call has no fallback).
--
-- 1. matches.status accepts 'called'. 0001 declared the check inline, so it has
--    Postgres' default name matches_status_check; drop + re-add (idempotent).
-- 2. matches.called_at: when the match was called (null otherwise).
-- 3. call_match / uncall_match RPCs. Rules (mirrored in lib/tournament/courts.ts
--    → the route gives friendly errors, the RPC stays the authority). Violations
--    raise P0422 with message match_not_callable / court_not_found / court_busy
--    (nothing is written); the tournament version is bumped on success.
--    Starting a called match uses the existing paths unchanged (lock/'start'
--    treat 'called' like 'scheduled'; results do not look at the old status).
alter table turnering.matches drop constraint if exists matches_status_check;
alter table turnering.matches
  add constraint matches_status_check
  check (status in ('scheduled','called','live','done','bye'));

alter table turnering.matches add column if not exists called_at timestamptz;

create or replace function turnering.call_match(
  p_match uuid,
  p_court uuid
) returns turnering.matches
language plpgsql
set search_path = ''
as $$
declare
  m turnering.matches;
  c turnering.courts;
begin
  select * into m from turnering.matches where id = p_match for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  -- Serialise callers on the court row so two organisers cannot fill one court.
  select * into c from turnering.courts
   where id = p_court and tournament_id = m.tournament_id for update;
  if not found then
    raise exception 'court_not_found' using errcode = 'P0422';
  end if;

  if m.status <> 'scheduled' or m.home_team_id is null or m.away_team_id is null then
    raise exception 'match_not_callable' using errcode = 'P0422';
  end if;

  if exists (
    select 1 from turnering.matches
     where court_id = p_court and id <> p_match and status in ('live', 'called')
  ) then
    raise exception 'court_busy' using errcode = 'P0422';
  end if;

  update turnering.matches
     set status = 'called', court_id = p_court, called_at = now()
   where id = p_match
  returning * into m;

  perform turnering.bump_version(m.tournament_id);
  return m;
end;
$$;

-- Back to 'scheduled'. Only a match that is still 'called' (not yet started).
create or replace function turnering.uncall_match(
  p_match uuid
) returns turnering.matches
language plpgsql
set search_path = ''
as $$
declare
  m turnering.matches;
begin
  select * into m from turnering.matches where id = p_match for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if m.status <> 'called' then
    raise exception 'match_not_callable' using errcode = 'P0422';
  end if;

  update turnering.matches
     set status = 'scheduled', called_at = null
   where id = p_match
  returning * into m;

  perform turnering.bump_version(m.tournament_id);
  return m;
end;
$$;

revoke execute on function turnering.call_match(uuid, uuid) from public, anon, authenticated;
grant execute on function turnering.call_match(uuid, uuid) to service_role;
revoke execute on function turnering.uncall_match(uuid) from public, anon, authenticated;
grant execute on function turnering.uncall_match(uuid) to service_role;
