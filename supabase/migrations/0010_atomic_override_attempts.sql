-- 0010: atomic organiser override + shared-IP-safe code-guess limiter.
-- Additive and idempotent (create or replace / if not exists). No triggers.
-- Conventions copied from 0004/0009: plain (invoker) plpgsql, execute granted
-- to service_role only, RLS on with no policies for new tables.
--
-- MUST be applied in prod BEFORE the app version that calls these RPCs is
-- deployed (the override route has no fallback; the limiter fails open).

-- 1. override_match_result -------------------------------------------------
-- Does in ONE transaction what app/api/organiser/override used to do in several
-- round trips: lock the match, (optionally) reset the downstream knockout
-- matches that were fed by the old winner, write the new result with
-- result_version+1, propagate the winner through the bracket
-- (propagate_playoff_result, 0009) and bump the tournament version.
-- Validation / scoring stays in TypeScript (lib/tournament/scoring.ts); this
-- only persists the already-validated result. The reset plan is a port of
-- lib/tournament/downstream.ts (planDownstreamReset) and is recomputed here
-- under the row lock, so it can't go stale between the 409 check and the write.
create or replace function turnering.override_match_result(
  p_match_id         uuid,
  p_result           jsonb,
  p_winner_team_id   uuid,
  p_reset_downstream boolean default false
) returns turnering.matches
language plpgsql
as $$
declare
  m          turnering.matches;
  tgt        turnering.matches;
  link       record;
  cur        uuid;
  stack      uuid[] := array[]::uuid[];
  reset_ids  uuid[] := array[]::uuid[];
  clr_match  uuid[] := array[]::uuid[];
  clr_slot   text[] := array[]::text[];
  i          int;
begin
  select * into m from turnering.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if p_reset_downstream and m.phase = 'playoff' then
    stack := array[p_match_id];
    while coalesce(array_length(stack, 1), 0) > 0 loop
      cur := stack[array_length(stack, 1)];
      stack := stack[1:array_length(stack, 1) - 1];
      for link in
        select to_match_id, to_slot from turnering.bracket_links
        where from_match_id = cur
      loop
        select * into tgt from turnering.matches where id = link.to_match_id;
        if not found then continue; end if;
        -- The root's own slots are refilled by propagation below; deeper slots
        -- were fed by a match being reset, so they become unknown.
        if cur <> p_match_id then
          clr_match := clr_match || tgt.id;
          clr_slot  := clr_slot  || link.to_slot::text;
        end if;
        if tgt.status in ('live', 'done') and not (tgt.id = any(reset_ids)) then
          reset_ids := reset_ids || tgt.id;
          stack     := stack     || tgt.id;
        end if;
      end loop;
    end loop;

    if coalesce(array_length(reset_ids, 1), 0) > 0 then
      update turnering.matches
         set status         = 'scheduled',
             result         = null,
             winner_team_id = null,
             result_version = result_version + 1,
             locked_by      = null,
             result_by      = null
       where id = any(reset_ids);

      for i in 1 .. coalesce(array_length(clr_match, 1), 0) loop
        if clr_slot[i] = 'home' then
          update turnering.matches set home_team_id = null where id = clr_match[i];
        else
          update turnering.matches set away_team_id = null where id = clr_match[i];
        end if;
      end loop;

      update turnering.tournaments set status = 'playoff'
       where id = m.tournament_id and status = 'finished';
    end if;
  end if;

  update turnering.matches
     set result         = p_result,
         winner_team_id = p_winner_team_id,
         status         = 'done',
         result_version = result_version + 1,
         locked_by      = null,
         result_by      = null          -- organiser correction, not a referee save
   where id = p_match_id
  returning * into m;

  if m.phase = 'playoff' and m.winner_team_id is not null then
    perform * from turnering.propagate_playoff_result(p_match_id);
  end if;

  update turnering.tournaments set version = version + 1 where id = m.tournament_id;

  select * into m from turnering.matches where id = p_match_id;
  return m;
end;
$$;

grant execute on function turnering.override_match_result(uuid, jsonb, uuid, boolean) to service_role;

-- 2. code_attempts ---------------------------------------------------------
-- Failed-code counter per (scope, ip). `scope` is the tournament id for the
-- control-code routes, 'org:<tournament id>' for organiser-code routes and
-- 'attach' for /api/attach (no tournament known yet). Only FAILURES are
-- stored, so a hall of correct phones behind one public IP never counts.
create table if not exists turnering.code_attempts (
  scope        text        not null,
  ip           text        not null,
  window_start timestamptz not null default now(),
  failures     int         not null default 0,
  primary key (scope, ip)
);
create index if not exists code_attempts_window_idx
  on turnering.code_attempts (window_start);
alter table turnering.code_attempts enable row level security;
-- No policies on purpose: service role only (same as every other table).

-- Records one wrong guess. Starts a fresh window when the old one expired.
-- Returns true when this IP is now blocked for the scope.
create or replace function turnering.register_code_failure(
  p_scope    text,
  p_ip       text,
  p_window_s int,
  p_max      int
) returns boolean
language plpgsql
as $$
declare
  f int;
begin
  -- Keep the table small: forget anything long past any window.
  delete from turnering.code_attempts where window_start < now() - interval '1 day';

  insert into turnering.code_attempts as a (scope, ip, window_start, failures)
    values (p_scope, p_ip, now(), 1)
  on conflict (scope, ip) do update
    set failures     = case when a.window_start < now() - make_interval(secs => p_window_s)
                            then 1 else a.failures + 1 end,
        window_start = case when a.window_start < now() - make_interval(secs => p_window_s)
                            then now() else a.window_start end
  returning a.failures into f;

  return f >= p_max;
end;
$$;

create or replace function turnering.code_blocked(
  p_scope    text,
  p_ip       text,
  p_window_s int,
  p_max      int
) returns boolean
language sql
stable
as $$
  select coalesce((
    select failures >= p_max
           and window_start >= now() - make_interval(secs => p_window_s)
      from turnering.code_attempts
     where scope = p_scope and ip = p_ip
  ), false);
$$;

grant execute on function turnering.register_code_failure(text, text, int, int) to service_role;
grant execute on function turnering.code_blocked(text, text, int, int) to service_role;
