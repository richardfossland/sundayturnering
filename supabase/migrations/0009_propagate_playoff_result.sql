-- Atomic, idempotent bracket propagation (suite quality review, phase 3). The
-- old flow (lib/server/playoff.ts propagateResult) pushed a playoff winner
-- (and, for a bronze final, the loser) into the next match's slot via several
-- separate client-side writes: a select, then one update per bracket_links
-- row, then a version bump, then (for the final) a tournaments status update.
-- A crash/timeout between any two of those left the bracket half-updated, and
-- calling it twice (retry, two referees, organiser override re-correcting an
-- already-propagated match) had no explicit guard against re-doing the writes.
--
-- This folds the whole step into ONE plpgsql function so Postgres commits it
-- as a single transaction (all-or-nothing), and adds a small guard table so a
-- second call for the SAME result is a true no-op rather than just "happens
-- to be harmless because it's all overwrites".

-- Guard table: remembers which result_version of a match was last propagated.
-- Kept separate from turnering.matches (rather than a new column there) so it
-- never flows into the Match DTO the board/control clients receive — it is
-- purely server-side bookkeeping.
create table if not exists turnering.bracket_propagations (
  match_id       uuid primary key references turnering.matches (id) on delete cascade,
  result_version int not null,
  updated_at     timestamptz not null default now()
);
alter table turnering.bracket_propagations enable row level security;
-- No policies on purpose, same as every other table in this schema — only the
-- service role (via the RPC below, or directly) touches it.

create or replace function turnering.propagate_playoff_result(p_match_id uuid)
returns table(finished boolean, propagated boolean)
language plpgsql
as $$
declare
  m               turnering.matches;
  loser_id        uuid;
  link            record;
  has_winner_link boolean;
  is_final        boolean;
  already_version int;
begin
  -- Lock the source match so two concurrent callers (double-tap, two referee
  -- devices, a retry racing the original) serialise instead of interleaving.
  select * into m from turnering.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if m.phase <> 'playoff' or m.winner_team_id is null then
    return query select false, false;
    return;
  end if;

  has_winner_link := exists (
    select 1 from turnering.bracket_links
    where from_match_id = p_match_id and feed <> 'loser'
  );
  is_final := m.bracket_slot = 0 and not has_winner_link;

  -- Idempotency guard: this exact result (same result_version) was already
  -- propagated → skip every write below. Assignment-style updates would
  -- mostly be harmless to repeat, but this also avoids a spurious extra
  -- tournaments.version bump on every duplicate call.
  select result_version into already_version
    from turnering.bracket_propagations where match_id = p_match_id;
  if already_version is not null and already_version = m.result_version then
    return query select is_final, false;
    return;
  end if;

  -- Bronze final: push the loser of this match into its loser-link slot(s).
  loser_id := case
    when m.home_team_id = m.winner_team_id then m.away_team_id
    else m.home_team_id
  end;
  if loser_id is not null then
    for link in
      select * from turnering.bracket_links
      where from_match_id = p_match_id and feed = 'loser'
    loop
      if link.to_slot = 'home' then
        update turnering.matches set home_team_id = loser_id where id = link.to_match_id;
      else
        update turnering.matches set away_team_id = loser_id where id = link.to_match_id;
      end if;
    end loop;
  end if;

  if has_winner_link then
    for link in
      select * from turnering.bracket_links
      where from_match_id = p_match_id and feed <> 'loser'
    loop
      if link.to_slot = 'home' then
        update turnering.matches set home_team_id = m.winner_team_id where id = link.to_match_id;
      else
        update turnering.matches set away_team_id = m.winner_team_id where id = link.to_match_id;
      end if;
    end loop;
  elsif is_final then
    -- No onward winner-link and this is bracket_slot 0 → the cup is decided.
    -- (A bronze final, slot 1, also has no onward winner-link but is_final is
    -- false for it, so it only records third place above.)
    update turnering.tournaments set status = 'finished' where id = m.tournament_id;
  end if;

  insert into turnering.bracket_propagations (match_id, result_version)
    values (p_match_id, m.result_version)
    on conflict (match_id)
    do update set result_version = excluded.result_version, updated_at = now();

  update turnering.tournaments set version = version + 1 where id = m.tournament_id;

  return query select is_final, true;
end;
$$;

grant execute on function turnering.propagate_playoff_result(uuid) to service_role;
