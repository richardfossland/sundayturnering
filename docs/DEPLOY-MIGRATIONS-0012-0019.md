# Migrasjoner 0012 → 0019: kjøring før deploy

Disse åtte filene ligger i `supabase/migrations/` og må kjøres i Supabase
**SQL-editor** (prosjekt `fwbfhwxgkjelcutwajza`). Alle er additive og idempotente
(`create or replace`, `if not exists`, `drop constraint if exists`), og ingen har
triggere.

> **Appen må IKKE deployes før alle åtte er kjørt.** Rutene har ingen fallback
> for de nye RPC-ene, kolonnene eller formatene (tidsplan, oppkalling, idempotent
> resultat, braketter, dobbel utslag, sveitsisk system, `precall_court_id`).

## Rekkefølge

Kjør hver fil **én gang**, i denne rekkefølgen. Lim inn hele filen, trykk Run,
og kontroller at det ikke kommer feil før neste fil.

| # | Fil | Innhold |
|---|-----|---------|
| 1 | `0012_schedule.sql` | `matches.scheduled_at` (tidsplan) |
| 2 | `0013_shift_schedule.sql` | `shift_schedule` |
| 3 | `0014_called.sql` | status `called`, `called_at`, `call_match`, `uncall_match` |
| 4 | `0015_idempotent_result.sql` | `result_requests`, `submit_match_result` (7 arg), `result_request_outcome` |
| 5 | `0016_brackets.sql` | `matches.bracket`, `propagate_playoff_result` |
| 6 | `0017_double_elim.sql` | format `double_elim`, omkamp i `propagate_playoff_result` |
| 7 | `0018_swiss.sql` | format `swiss` |
| 8 | `0019_review_fixes.sql` | rettelser fra gjennomgangen (se under) |

### Hva 0019 gjør

- `tournaments_format_check` med alle seks formater.
- `propagate_playoff_result` = 0017-logikken, men med `search_path = ''` og
  `execute` låst til `service_role`.
- `override_match_result`: nullstilling nedstrøms tar også med oppkalte kamper
  (`called` → `scheduled`, `called_at = null`).
- `submit_match_result` (7 arg): request-id slås opp sammen med kampen; en id som
  tilhører en annen kamp gir `request_id_conflict` (ruta svarer 409).
- `matches.precall_court_id`: `call_match` lagrer banen, `uncall_match`
  gjenoppretter den.

### Kjørt noe i feil rekkefølge, eller 0016/0017 om igjen?

Kjør `0019_review_fixes.sql` **til slutt**. Den setter alltid den endelige
tilstanden (format-CHECK med alle formater, `propagate_playoff_result` med
`search_path` og revoke), uansett hva eldre filer har overskrevet. Testen
`test/review-fixes-migration.test.ts` beviser dette.

## Sjekk etter kjøring

Kjør som én spørring. Alle rader skal ha `ok = true`.

```sql
with
fn(name, args) as (values
  ('shift_schedule',          'uuid, uuid, timestamp with time zone, integer'),
  ('call_match',              'uuid, uuid'),
  ('uncall_match',            'uuid'),
  ('submit_match_result',     'uuid, integer, jsonb, uuid, text, text, uuid'),
  ('result_request_outcome',  'uuid, uuid'),
  ('propagate_playoff_result','uuid'),
  ('override_match_result',   'uuid, jsonb, text, boolean')
)
select 'funksjon ' || fn.name as sjekk,
       (p.oid is not null
        and coalesce(p.proconfig::text like '%search_path%', false)
        and has_function_privilege('service_role', p.oid, 'execute')
        and not has_function_privilege('anon', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute')) as ok
  from fn
  left join pg_proc p
    on p.proname = fn.name
   and p.pronamespace = 'turnering'::regnamespace
   and oidvectortypes(p.proargtypes) = fn.args

union all
select 'kolonne matches.' || c,
       exists (select 1 from information_schema.columns
                where table_schema = 'turnering' and table_name = 'matches' and column_name = c)
  from unnest(array['scheduled_at', 'called_at', 'bracket', 'precall_court_id']) as c

union all
select 'tabell result_requests',
       to_regclass('turnering.result_requests') is not null

union all
select 'tournaments_format_check har alle formater',
       (select bool_and(pg_get_constraintdef(oid) like '%' || f || '%')
          from pg_constraint, unnest(array['league', 'league_playoff', 'cup',
                                           'group_playoff', 'double_elim', 'swiss']) as f
         where conrelid = 'turnering.tournaments'::regclass
           and conname = 'tournaments_format_check')

union all
select 'matches_status_check har called',
       (select pg_get_constraintdef(oid) like '%called%'
          from pg_constraint
         where conrelid = 'turnering.matches'::regclass and conname = 'matches_status_check')

union all
select 'matches_bracket_check finnes',
       exists (select 1 from pg_constraint
                where conrelid = 'turnering.matches'::regclass and conname = 'matches_bracket_check');
```

Forventet: 7 funksjonsrader + 4 kolonner + 4 øvrige = 15 rader, alle `ok = true`.
Er noen `false`/`null`, kjør filen for raden på nytt (eller `0019` hvis det gjelder
funksjoner/format-CHECK) og kjør spørringen igjen.

## Deploy

Først når sjekken er helt grønn: deploy appen (se `docs/DEPLOY.md`).
