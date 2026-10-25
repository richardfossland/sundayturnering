-- 0015: idempotent result submit (A5 «Dommertelefon uten nett»).
-- Additive and idempotent (create ... if not exists / create or replace). No
-- triggers, nothing dropped: the old 5- and 6-arg overloads of
-- submit_match_result stay, so the currently deployed Worker keeps working
-- until the new code is live (zero downtime, same approach as 0005).
--
-- A referee phone with flaky wifi queues the result and re-sends it until it
-- gets an answer. The first send may well have committed with only the reply
-- lost; the repeat must then return the SAME outcome, not bump the version a
-- second time and not 409 against its own write. Each send carries a client
-- generated request id; the outcome of the first commit is stored under it.
--
-- Hardening as 0010/0014: pinned search_path, schema-qualified references,
-- execute revoked from public/anon/authenticated and granted to service_role,
-- RLS on with no policies for the new table.
--
-- MUST be applied in prod BEFORE the app version that sends requestId is
-- deployed (the route only uses the new RPC when the client sends one).

create table if not exists turnering.result_requests (
  request_id uuid        primary key,
  match_id   uuid        not null references turnering.matches (id) on delete cascade,
  response   jsonb       not null,   -- the matches row as committed
  created_at timestamptz not null default now()
);
create index if not exists result_requests_created_idx
  on turnering.result_requests (created_at);
alter table turnering.result_requests enable row level security;
-- No policies on purpose: service role only (RLS bypass is not a table
-- privilege, so the invoker functions below need the grant).
grant select, insert, delete on turnering.result_requests to service_role;

-- 7-arg overload: as the 6-arg form plus p_request_id. A repeat of a processed
-- id returns the stored row (same outcome); anything else takes the normal
-- version-guarded path, so a DIFFERENT id after a commit is an ordinary
-- version_conflict.
create or replace function turnering.submit_match_result(
  p_match_id         uuid,
  p_expected_version int,
  p_result           jsonb,
  p_winner_team_id   uuid,
  p_status           text,
  p_result_by        text,
  p_request_id       uuid
) returns turnering.matches
language plpgsql
set search_path = ''
as $$
declare
  m      turnering.matches;
  stored jsonb;
begin
  select * into m from turnering.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  -- Checked under the match lock: two concurrent sends of the same id queue up
  -- on the row, the second one then sees the first one's record.
  select response into stored from turnering.result_requests
   where request_id = p_request_id;
  if found then
    return jsonb_populate_record(null::turnering.matches, stored);
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

  -- Keep the table small: a queued result is never retried a week later.
  delete from turnering.result_requests where created_at < now() - interval '7 days';
  insert into turnering.result_requests (request_id, match_id, response)
    values (p_request_id, p_match_id, to_jsonb(m));

  return m;
end;
$$;

-- Replay probe for the route: the stored outcome for this id on this match, or
-- null. Lets a repeat be answered BEFORE the «already done» / «tournament
-- finished» guards, which the first send's own commit may have tripped.
create or replace function turnering.result_request_outcome(
  p_request_id uuid,
  p_match_id   uuid
) returns jsonb
language sql
stable
set search_path = ''
as $$
  select response from turnering.result_requests
   where request_id = p_request_id and match_id = p_match_id;
$$;

revoke execute on function
  turnering.submit_match_result(uuid, int, jsonb, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function
  turnering.submit_match_result(uuid, int, jsonb, uuid, text, text, uuid)
  to service_role;
revoke execute on function turnering.result_request_outcome(uuid, uuid)
  from public, anon, authenticated;
grant execute on function turnering.result_request_outcome(uuid, uuid)
  to service_role;
