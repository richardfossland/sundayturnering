-- Per-court countdown timer (spec extension). In parallel mode each court runs
-- an independent clock the referee can start/stop; sequential mode keeps using
-- the tournament-level timer (0003). Additive + nullable.

alter table turnering.courts
  add column if not exists timer jsonb;
