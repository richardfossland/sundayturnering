-- 0017: dobbel utslag (format 'double_elim'). Additiv og idempotent. Ingen triggere.
--
-- 1. tournaments.format godtar 'double_elim' (CHECK fra 0008 bygges på nytt).
-- 2. propagate_playoff_result (0016) kjenner omkampen i storfinalen:
--      GF runde 1 = storfinalen (W-vinner hjemme, L-vinner borte),
--      GF runde 2 = omkampen. Storfinalen har vanlige koblinger til omkampen
--      (vinner → hjemme, taper → borte), så lagene flyter som i alle andre braketter.
--    Vinner W-laget (hjemme) storfinalen, utgår omkampen (status 'bye', vinner =
--    storfinalens vinner) og turneringen er avgjort. Vinner L-laget, spilles
--    omkampen; var den utgått (overstyrt storfinale) gjenåpnes den.
--    Turneringen er ferdig når ALLE brakettfinaler er avgjort, som i 0016.
-- Samme signatur som 0009/0016 → ingen nedetid. override_match_result (0010)
-- følger koblingene generelt, så den trenger ingen endring: storfinalen → omkampen
-- er en vanlig kobling, og en spilt omkamp nullstilles når storfinalen overstyres.
-- Må kjøres FØR appversjonen som bygger dobbel utslag deployes.

alter table turnering.tournaments
  drop constraint if exists tournaments_format_check;
alter table turnering.tournaments
  add constraint tournaments_format_check
  check (format in ('league', 'league_playoff', 'cup', 'group_playoff', 'double_elim'));

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

grant execute on function turnering.propagate_playoff_result(uuid) to service_role;
