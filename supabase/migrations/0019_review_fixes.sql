-- 0019: rettelser fra gjennomgangen (runde etter 0012–0018). Additiv og idempotent.
-- Ingen triggere. Kan kjøres på nytt, og kan kjøres ETTER at eldre filer er kjørt
-- om igjen (0016/0017/0018 bygger CHECK og propagate_playoff_result på nytt i
-- eldre form): 0019 setter alltid den endelige tilstanden.
--
-- 1. tournaments_format_check med ALLE formater (league, league_playoff, cup,
--    group_playoff, double_elim, swiss).
-- 2. propagate_playoff_result = 0017-logikken uendret, men nå med
--    search_path = '' (alt er skjemakvalifisert) og execute låst til service_role
--    som i 0010. (0016/0017 ga den hverken search_path eller revoke.)
-- 3. override_match_result (0010): nullstillingen av nedstrøms kamper tar nå også
--    med 'called' (status tilbake til 'scheduled', called_at = null).
-- 4. submit_match_result (7 arg, 0015): request-id slås opp sammen med match_id.
--    En id som finnes for en ANNEN kamp gir P0422 request_id_conflict (ruta
--    svarer 409, så utboksen forkaster den i stedet for å prøve for alltid).
-- 5. matches.precall_court_id: banen kampen hadde før oppkalling. call_match
--    lagrer den, uncall_match gjenoppretter og tømmer den. (Kamper kalt opp før
--    0019 har ingen lagret bane og får court_id = null ved uncall.)
-- shift_schedule, result_request_outcome, call_match og uncall_match hadde allerede
-- search_path og revoke (0013–0015); signaturene er uendret.
--
-- Må kjøres FØR appversjonen som sender request_id_conflict-håndtering deployes.

alter table turnering.tournaments
  drop constraint if exists tournaments_format_check;
alter table turnering.tournaments
  add constraint tournaments_format_check
  check (format in ('league', 'league_playoff', 'cup', 'group_playoff', 'double_elim', 'swiss'));

alter table turnering.matches
  add column if not exists precall_court_id uuid references turnering.courts (id) on delete set null;

create or replace function turnering.propagate_playoff_result(p_match_id uuid)
returns table(finished boolean, propagated boolean)
language plpgsql
set search_path = ''
as $$
declare
  m               turnering.matches;
  loser_id        uuid;
  link            record;
  has_winner_link boolean;
  is_final        boolean;
  all_decided     boolean;
  already_version int;
  gf2_id          uuid;
  gf_void         boolean := false;
begin
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

  -- Storfinalen (GF runde 1) med omkamp: vant hjemmelaget (W-vinneren), utgår
  -- omkampen og storfinalen avgjør alt.
  if m.bracket = 'GF' and m.round = 1 then
    select id into gf2_id from turnering.matches
      where tournament_id = m.tournament_id and bracket = 'GF' and round = 2 and bracket_slot = 0;
    gf_void := gf2_id is not null and m.winner_team_id = m.home_team_id;
  end if;

  -- «En» brakettfinale: slot 0 uten vei videre (eller en storfinale som gjør
  -- omkampen overflødig). Ferdig først når ingen ANNEN brakettfinale står
  -- igjen uavgjort.
  is_final := (m.bracket_slot = 0 and not has_winner_link) or gf_void;
  all_decided := is_final and not exists (
    select 1 from turnering.matches x
    where x.tournament_id = m.tournament_id
      and x.phase = 'playoff'
      and x.id <> m.id
      and x.bracket_slot = 0
      and x.status not in ('done', 'bye')
      and not (gf_void and x.id = gf2_id)
      and not exists (
        select 1 from turnering.bracket_links l
        where l.from_match_id = x.id and l.feed <> 'loser'
      )
  );

  select result_version into already_version
    from turnering.bracket_propagations where match_id = p_match_id;
  if already_version is not null and already_version = m.result_version then
    return query select all_decided, false;
    return;
  end if;

  -- Taper-koblinger (bronsefinale, trøsterunde, taperbrakett, omkamp): taperen
  -- videre til sin plass.
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
  end if;

  if gf2_id is not null then
    if gf_void then
      update turnering.matches
         set status = 'bye', winner_team_id = m.winner_team_id, result = null
       where id = gf2_id;
    else
      -- L-laget vant: omkampen skal spilles (gjenåpnes hvis den var utgått).
      update turnering.matches
         set status = 'scheduled', winner_team_id = null, result = null
       where id = gf2_id and status = 'bye';
      if found then
        -- Turneringen var avgjort på storfinalen; nå mangler omkampen.
        update turnering.tournaments set status = 'playoff'
         where id = m.tournament_id and status = 'finished';
      end if;
    end if;
  end if;

  if all_decided then
    update turnering.tournaments set status = 'finished' where id = m.tournament_id;
  end if;

  insert into turnering.bracket_propagations (match_id, result_version)
    values (p_match_id, m.result_version)
    on conflict (match_id)
    do update set result_version = excluded.result_version, updated_at = now();

  update turnering.tournaments set version = version + 1 where id = m.tournament_id;

  return query select all_decided, true;
end;
$$;


create or replace function turnering.override_match_result(
  p_match_id         uuid,
  p_result           jsonb,
  p_winner_side      text,            -- 'home' | 'away' | null (mapped under the lock)
  p_allow_reset      boolean default false
) returns turnering.matches
language plpgsql
set search_path = ''
as $$
declare
  m          turnering.matches;
  new_winner uuid;
  changed    boolean;
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

  -- The winner is derived HERE from the side, with the teams as they are under
  -- the lock (not from a snapshot the route read before the lock).
  new_winner := case p_winner_side
                  when 'home' then m.home_team_id
                  when 'away' then m.away_team_id
                  else null end;
  changed := m.status = 'done' and new_winner is distinct from m.winner_team_id;

  if changed and m.phase = 'playoff' then
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
        if tgt.status in ('called', 'live', 'done') and not (tgt.id = any(reset_ids)) then
          reset_ids := reset_ids || tgt.id;
          stack     := stack     || tgt.id;
        end if;
      end loop;
    end loop;

    if coalesce(array_length(reset_ids, 1), 0) > 0 then
      -- Played matches downstream would be wiped: only with the organiser's
      -- explicit say-so (decided under the lock, so it cannot go stale).
      if not p_allow_reset then
        raise exception 'downstream_played' using errcode = 'P0409',
          detail = array_length(reset_ids, 1)::text;
      end if;
      update turnering.matches
         set status         = 'scheduled',
             called_at      = null,
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
         winner_team_id = new_winner,
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
   where request_id = p_request_id and match_id = p_match_id;
  if found then
    return jsonb_populate_record(null::turnering.matches, stored);
  end if;
  -- Same id, different match: never answer with another match's outcome (the
  -- primary key would also refuse the insert below). The route maps this to
  -- 409 so the referee outbox drops the entry instead of retrying forever.
  if exists (select 1 from turnering.result_requests where request_id = p_request_id) then
    raise exception 'request_id_conflict' using errcode = 'P0422';
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
     set status = 'called', precall_court_id = court_id, court_id = p_court, called_at = now()
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
     set status = 'scheduled', court_id = precall_court_id, precall_court_id = null, called_at = null
   where id = p_match
  returning * into m;

  perform turnering.bump_version(m.tournament_id);
  return m;
end;
$$;


revoke execute on function turnering.propagate_playoff_result(uuid)
  from public, anon, authenticated;
grant execute on function turnering.propagate_playoff_result(uuid) to service_role;

revoke execute on function turnering.override_match_result(uuid, jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function turnering.override_match_result(uuid, jsonb, text, boolean) to service_role;

revoke execute on function
  turnering.submit_match_result(uuid, int, jsonb, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function
  turnering.submit_match_result(uuid, int, jsonb, uuid, text, text, uuid)
  to service_role;

revoke execute on function turnering.call_match(uuid, uuid) from public, anon, authenticated;
grant execute on function turnering.call_match(uuid, uuid) to service_role;
revoke execute on function turnering.uncall_match(uuid) from public, anon, authenticated;
grant execute on function turnering.uncall_match(uuid) to service_role;
