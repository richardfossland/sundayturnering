-- 0016: flere braketter per turnering (B-sluttspill / trøsterunde, senere dobbel
-- utslag). Additiv og idempotent. Ingen triggere.
--
-- `matches.bracket` sier hvilken brakett en sluttspillkamp hører til:
--   'A'  hovedbrakett (alle eksisterende rader — default),
--   'B'  B-sluttspill / trøsterunde,
--   'W'/'L'/'GF'  vinner-/taperbrakett og storfinale (dobbel utslag, kommer i B4).
-- Ligakamper er alltid 'A'. Det fantes ingen unik indeks over
-- (tournament, round, bracket_slot) fra før, så ingen indeks må bygges om;
-- (round, bracket_slot) er bare entydig INNENFOR en brakett, og koden nøkler på
-- (bracket, round, bracket_slot).
--
-- propagate_playoff_result (0009) antok én brakett: «bracket_slot 0 uten
-- vinner-kobling» = finalen = turneringen er ferdig. Med to braketter ville
-- den første finalen avslutte turneringen. Nå avsluttes den først når ALLE
-- brakettfinaler er avgjort. Bronsefinalen (slot 1) blokkerer fortsatt ikke,
-- som før. Samme signatur → ingen nedetid. Må kjøres FØR appversjonen som
-- bygger B-braketter deployes.

alter table turnering.matches
  add column if not exists bracket text not null default 'A';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_bracket_check' and conrelid = 'turnering.matches'::regclass
  ) then
    alter table turnering.matches
      add constraint matches_bracket_check
      check (bracket in ('A', 'B', 'W', 'L', 'GF'));
  end if;
end $$;

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
  -- «En» brakettfinale: slot 0 uten vei videre. Turneringen er ferdig først når
  -- ingen ANNEN brakettfinale står igjen uavgjort.
  is_final := m.bracket_slot = 0 and not has_winner_link;
  all_decided := is_final and not exists (
    select 1 from turnering.matches x
    where x.tournament_id = m.tournament_id
      and x.phase = 'playoff'
      and x.id <> m.id
      and x.bracket_slot = 0
      and x.status not in ('done', 'bye')
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

  -- Taper-koblinger (bronsefinale, trøsterunde): taperen videre til sin plass.
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
  elsif all_decided then
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
