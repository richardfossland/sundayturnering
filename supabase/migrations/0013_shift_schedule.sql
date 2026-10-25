-- 0013: skyv tidsplanen (A2). Organiser pushes (or pulls) scheduled_at for the
-- not-yet-finished matches in ONE transaction. Additive and idempotent
-- (create or replace). No triggers. Conventions copied from 0004/0010: plpgsql,
-- search_path pinned, execute granted to service_role only.
--
-- MUST be applied in prod BEFORE the app version that calls it is deployed
-- (app/api/organiser/shift has no fallback).
--
-- Rules (mirrored in lib/tournament/schedule.ts → previewShift, which the UI and
-- the route use to give friendly errors; the RPC stays the authority):
--   * only matches of the tournament that are not done/bye/live and have a
--     scheduled_at >= p_from; optionally only one court
--   * |p_minutes| <= 240 and p_minutes <> 0
--   * a NEGATIVE shift may not land earlier than now() - 1 minute (a positive shift of an overdue match is fine)
-- Violations raise with errcode P0422 and message shift_too_large /
-- shift_zero / shift_in_past (nothing is written). Returns the affected count;
-- the tournament version is bumped only when something moved.
create or replace function turnering.shift_schedule(
  p_tournament uuid,
  p_court      uuid,           -- null = alle baner
  p_from       timestamptz,
  p_minutes    int
) returns int
language plpgsql
set search_path = ''
as $$
declare
  ids uuid[];
  n   int;
begin
  if p_minutes is null or p_minutes = 0 then
    raise exception 'shift_zero' using errcode = 'P0422';
  end if;
  if abs(p_minutes) > 240 then
    raise exception 'shift_too_large' using errcode = 'P0422';
  end if;

  -- Lock the affected rows so a concurrent result/shift cannot interleave.
  select coalesce(array_agg(id), array[]::uuid[]) into ids
    from (
      select id from turnering.matches
       where tournament_id = p_tournament
         and status not in ('done', 'bye', 'live')
         and scheduled_at is not null
         and scheduled_at >= p_from
         and (p_court is null or court_id = p_court)
       order by id
       for update
    ) s;

  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then
    return 0;
  end if;

  if exists (
    select 1 from turnering.matches
     where id = any(ids)
       and p_minutes < 0
       and scheduled_at + make_interval(mins => p_minutes) < now() - interval '1 minute'
  ) then
    raise exception 'shift_in_past' using errcode = 'P0422';
  end if;

  update turnering.matches
     set scheduled_at = scheduled_at + make_interval(mins => p_minutes)
   where id = any(ids);

  perform turnering.bump_version(p_tournament);
  return n;
end;
$$;

revoke execute on function turnering.shift_schedule(uuid, uuid, timestamptz, int)
  from public, anon, authenticated;
grant execute on function turnering.shift_schedule(uuid, uuid, timestamptz, int) to service_role;
