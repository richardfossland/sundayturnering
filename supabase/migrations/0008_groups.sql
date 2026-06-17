-- Group stage + playoff (spec extension). A group is just an integer label
-- (like `round`): no extra table. `teams.group_no` is the source of truth for
-- membership; `matches.group_no` denormalises it so per-group standings/board
-- can partition without a join. Both nullable (null = league/cup). The format
-- CHECK is widened to allow the new value — existing rows still satisfy it.

alter table turnering.teams
  add column if not exists group_no int;

alter table turnering.matches
  add column if not exists group_no int;

alter table turnering.tournaments
  drop constraint if exists tournaments_format_check;

alter table turnering.tournaments
  add constraint tournaments_format_check
  check (format in ('league', 'league_playoff', 'cup', 'group_playoff'));
