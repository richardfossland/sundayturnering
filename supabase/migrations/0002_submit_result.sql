-- Atomic, optimistic-concurrency result write (spec §4). The control device
-- sends the result_version it based its edit on; the write succeeds only if the
-- stored version still matches, then bumps it. Two phones submitting against the
-- same version → exactly one wins; the loser gets 'version_conflict' and must
-- refetch. The row lock (FOR UPDATE) serialises concurrent callers.

create or replace function turnering.submit_match_result(
  p_match_id         uuid,
  p_expected_version int,
  p_result           jsonb,
  p_winner_team_id   uuid,
  p_status           text
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
         locked_by      = null
   where id = p_match_id
  returning * into m;

  return m;
end;
$$;

grant execute on function turnering.submit_match_result(uuid, int, jsonb, uuid, text) to service_role;
