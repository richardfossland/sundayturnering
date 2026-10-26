# Migrasjon 0020: bronsefinale, angre oppkalling og utdatert kø

Filen `supabase/migrations/0020_bronze_uncall_stale_queue.sql` kjøres i Supabase
**SQL-editor** (prosjekt `fwbfhwxgkjelcutwajza`), etter `0019`. Den er additiv og
idempotent (`create or replace`, `add column if not exists`, `drop trigger if exists`)
og kan kjøres på nytt.

> **Kjør 0020 SIST.** Kjøres 0019 (eller 0016/0017) om igjen etterpå, legger de den
> gamle `propagate_playoff_result` tilbake (finalen avslutter turneringen før
> bronsefinalen). Kjør da 0020 på nytt.

## Hva den gjør

| Funn | Endring |
|------|---------|
| B2 | `propagate_playoff_result`: turneringen avsluttes først når alle brakettfinaler **og** bronsefinalen (A, slot 1, mates av taper-koblinger) er `done`/`bye`. Den som avgjøres sist avslutter. Dobbel utslag er uendret. |
| A7 | `matches.precall_court_id` (finnes fra 0019) + `call_match`/`uncall_match` (uendret fra 0019): «Angre oppkalling» gir tilbake banen kampen hadde, eller ingen bane. |
| C7 | Trigger `matches_team_change_bump_version`: når et lag som var satt i en kamp byttes eller fjernes, øker `result_version`. Et resultat i telefonens utboks avvises da med `version_conflict` (HTTP 409 «konflikt», vist som «kunne ikke sendes»). |

## Rekkefølge mot app-deploy (begge veier virker)

- **Appen først, SQL etterpå:** appen leser aldri `precall_court_id` ved navn (og
  fjerner den fra offentlige data hvis den finnes). Bronsefinalen settes før finalen i
  køen uansett. Før SQL-en er kjørt gjelder gammel oppførsel: finalen avslutter
  turneringen, og lagbytte øker ikke versjonen.
- **SQL først, appen etterpå:** gammel app + ny SQL er trygt. Turneringen står åpen til
  bronsefinalen er spilt, og den gamle appen viser den som spillbar.

## Sjekk etter kjøring

Alle rader skal ha `ok = true`.

```sql
select 'trigger matches_team_change_bump_version' as sjekk,
       exists (select 1 from pg_trigger
                where tgrelid = 'turnering.matches'::regclass
                  and tgname = 'matches_team_change_bump_version'
                  and not tgisinternal) as ok
union all
select 'kolonne matches.precall_court_id',
       exists (select 1 from information_schema.columns
                where table_schema = 'turnering' and table_name = 'matches'
                  and column_name = 'precall_court_id')
union all
select 'propagate_playoff_result kjenner bronsefinalen',
       (select pg_get_functiondef(p.oid) like '%annen bronsefinale%'
          from pg_proc p
         where p.pronamespace = 'turnering'::regnamespace
           and p.proname = 'propagate_playoff_result')
union all
select 'propagate_playoff_result er låst til service_role',
       (select has_function_privilege('service_role', p.oid, 'execute')
               and not has_function_privilege('anon', p.oid, 'execute')
               and not has_function_privilege('authenticated', p.oid, 'execute')
               and coalesce(p.proconfig::text like '%search_path%', false)
          from pg_proc p
         where p.pronamespace = 'turnering'::regnamespace
           and p.proname = 'propagate_playoff_result');
```
