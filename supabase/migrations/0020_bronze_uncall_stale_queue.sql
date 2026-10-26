-- 0020: bronsefinale før finale, «Angre oppkalling» med opprinnelig bane og
-- utdatert resultat i kø. Additiv og idempotent (create or replace / if not exists).
-- Kan kjøres på nytt. Samme signaturer, search_path og grants som 0019.
--
-- 1. B2 — propagate_playoff_result (0019-logikken uendret, pluss):
--    turneringen avsluttes først når ALLE brakettfinaler (slot 0 uten vei videre)
--    OG bronsefinalen (A, slot 1, mates av taper-koblinger) er avgjort ('done' eller
--    'bye'). Avgjøres bronsefinalen etter finalen, er det den som avslutter
--    turneringen. Dobbel utslag (storfinale/omkamp, 0017/0019) er uendret: der finnes
--    ingen bronsefinale.
-- 2. A7 — matches.precall_court_id (add column if not exists, finnes allerede fra 0019)
--    og call_match/uncall_match (identiske med 0019, tatt med så 0020 er selvforsynt):
--    call_match lagrer banen kampen hadde (kun fra status 'scheduled', så en
--    allerede oppkalt kamp aldri overskriver den), uncall_match gjenoppretter den
--    (null hvis kampen ikke hadde bane) og tømmer feltet.
-- 3. C7 — trigger matches_team_change_bump_version: bytter en kamp et lag som var
--    satt (hjemme- eller bortelag endres, eller tømmes), økes result_version, med
--    mindre samme UPDATE allerede har økt den. Et resultat i telefonens utboks har
--    forventet versjon fra før byttet, og avvises da av submit_match_result med
--    version_conflict (HTTP 409 «konflikt», som utboksen viser som avvist).
--    En tom plass som fylles (null → lag) øker ikke versjonen: en kamp uten begge
--    lag kan ikke ha noe resultat i kø.
--
-- Bakoverkompatibelt: appen virker både før og etter at denne kjøres (ingen nye
-- kolonner leses ved navn; bronsefinale-først i køen er ren appkode og virker
-- uavhengig av SQL-en).

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
  is_bronze       boolean;
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
  -- omkampen overflødig).
  is_final := (m.bracket_slot = 0 and not has_winner_link) or gf_void;

  -- Bronsefinalen: hovedbrakettens (A) slot 1, mates av taper-koblinger og har
  -- ingen vei videre. Den teller med i «turneringen er avgjort» (0020).
  is_bronze := coalesce(m.bracket, 'A') = 'A'
    and m.bracket_slot = 1
    and not has_winner_link
    and exists (
      select 1 from turnering.bracket_links l
      where l.to_match_id = m.id and l.feed = 'loser'
    );

  -- Ferdig først når ingen ANNEN brakettfinale og ingen ANNEN bronsefinale står
  -- igjen uavgjort, og bare når DENNE kampen selv er en finale eller bronsefinale.
  -- Den som blir ferdig sist avslutter turneringen (finalen kan spilles før
  -- bronsefinalen og omvendt).
  all_decided := (is_final or is_bronze) and not exists (
    select 1 from turnering.matches x
    where x.tournament_id = m.tournament_id
      and x.phase = 'playoff'
      and x.id <> m.id
      and x.status not in ('done', 'bye')
      and not (gf_void and x.id = gf2_id)
      and (
        -- annen brakettfinale
        (
          x.bracket_slot = 0
          and not exists (
            select 1 from turnering.bracket_links l
            where l.from_match_id = x.id and l.feed <> 'loser'
          )
        )
        -- annen bronsefinale
        or (
          coalesce(x.bracket, 'A') = 'A'
          and x.bracket_slot = 1
          and not exists (
            select 1 from turnering.bracket_links l
            where l.from_match_id = x.id and l.feed <> 'loser'
          )
          and exists (
            select 1 from turnering.bracket_links l
            where l.to_match_id = x.id and l.feed = 'loser'
          )
        )
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

-- C7: lagbytte i en kamp utdaterer alt som er sendt inn mot den gamle versjonen.
create or replace function turnering.matches_team_change_bump_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.result_version = old.result_version
     and (
       (old.home_team_id is not null and new.home_team_id is distinct from old.home_team_id)
       or (old.away_team_id is not null and new.away_team_id is distinct from old.away_team_id)
     )
  then
    new.result_version := old.result_version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists matches_team_change_bump_version on turnering.matches;
create trigger matches_team_change_bump_version
  before update of home_team_id, away_team_id on turnering.matches
  for each row
  execute function turnering.matches_team_change_bump_version();

revoke execute on function turnering.matches_team_change_bump_version()
  from public, anon, authenticated;

revoke execute on function turnering.propagate_playoff_result(uuid)
  from public, anon, authenticated;
grant execute on function turnering.propagate_playoff_result(uuid) to service_role;

revoke execute on function turnering.call_match(uuid, uuid) from public, anon, authenticated;
grant execute on function turnering.call_match(uuid, uuid) to service_role;
revoke execute on function turnering.uncall_match(uuid) from public, anon, authenticated;
grant execute on function turnering.uncall_match(uuid) to service_role;
