-- Atomic version bump (board cache-busting). Replaces a read-then-write in the
-- app, which could lose increments under concurrent structural changes.

create or replace function turnering.bump_version(p_id uuid)
returns void
language sql
as $$
  update turnering.tournaments set version = version + 1 where id = p_id;
$$;

grant execute on function turnering.bump_version(uuid) to service_role;
