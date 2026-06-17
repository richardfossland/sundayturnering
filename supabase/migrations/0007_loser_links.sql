-- Bronze final / third-place match (spec extension). A bracket link normally
-- carries the WINNER of a match into the next slot; a 'loser' link carries the
-- LOSER (the two semifinal losers feed the bronze final). Additive with a
-- default, so existing links decode as 'winner' and current propagation is
-- unchanged.

alter table turnering.bracket_links
  add column if not exists feed text not null default 'winner'
  check (feed in ('winner', 'loser'));
