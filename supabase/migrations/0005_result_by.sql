-- Referee self-correct grace window (spec extension). Track which device saved
-- the current result so the same device may fix its own mistake within a short
-- window (server-checked) without the organiser code. Additive + nullable, so
-- existing rows decode as null.

alter table turnering.matches
  add column if not exists result_by text;

-- Replace the result RPC with a 6-arg version that also stamps result_by. We
-- drop the old 5-arg overload first so only one function remains (otherwise
-- `create or replace` with a new arg list would leave a stale overload behind).
drop function if exists turnering.submit_match_result(uuid, int, jsonb, uuid, text);

create or replace function turnering.submit_match_result(
  p_match_id         uuid,
  p_expected_version int,
  p_result           jsonb,
  p_winner_team_id   uuid,
  p_status           text,
  p_result_by        text
) returns turnering.matches
language plpgsql
as $$
declare
  m turnering.matches;
begin
  select * into m from turnering.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if m.result_version <> p_expected_version then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;

  update turnering.matches
     set result         = p_result,
         winner_team_id = p_winner_team_id,
         status         = p_status,
         result_version = result_version + 1,
         locked_by      = null,
         result_by      = p_result_by
   where id = p_match_id
  returning * into m;

  return m;
end;
$$;

grant execute on function
  turnering.submit_match_result(uuid, int, jsonb, uuid, text, text)
  to service_role;
