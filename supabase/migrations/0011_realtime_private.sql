-- 0011: Realtime Authorization for the tournament channels (private channels).
-- Additive and idempotent (create or replace / drop policy if exists). No triggers.
--
-- Today `t:<id>` is a PUBLIC broadcast topic: anyone holding the anon key (it
-- ships in the client bundle) and a tournament id (it is in every board /
-- spectator URL) can .send() forged match_updated / structure / lock_changed
-- hints. No data is corrupted — hints only trigger a refetch of authoritative
-- state — but a forged hint makes every phone + the projector refetch at once,
-- and forged cheers/presence put fake theatre on the board / control page.
--
-- Fix: clients subscribe with `private: true`, which makes Realtime authorize
-- every join against RLS on realtime.messages. Topics:
--   t:<id>           server hints — anon may RECEIVE only. Server publish uses
--                    the service_role REST endpoint and bypasses RLS.
--   t:<id>:cheer     spectator cheers — anon may receive AND send broadcast.
--                    Forged cheers are accepted: clamped by parseReactionPayload,
--                    no state behind them.
--   t:<id>:presence  control devices — anon may receive AND track presence.
-- Every policy also requires the tournament to exist (rt_topic_ok), so nobody
-- can squat arbitrary t:* topics.
--
-- ⚠️ This project is SHARED with other Sunday apps. Policies on
-- realtime.messages are OR'ed across apps per command, so every policy here is
-- scoped to `t:` topics and touches nothing else. Do NOT disable public
-- channels project-wide until every app in the project subscribes privately.
--
-- Realtime runs probe SELECT/INSERTs on realtime.messages AS the subscriber's
-- role, so anon/authenticated need plain grants as well as the policies — a
-- policy alone yields "Unauthorized" at subscribe.
--
-- realtime.messages is Supabase-managed and absent from a vanilla postgres
-- harness, so the grants + policies are guarded on its presence (clean no-op
-- there). Safe to apply BEFORE the client switches to private channels: public
-- channels are not affected by these policies.

-- 1. rt_topic_ok -------------------------------------------------------------
-- True iff `p_topic` is one of this app's topic shapes for an EXISTING
-- tournament. security definer so the policies can check existence without
-- anon having any table access (RLS on tournaments has no anon policy). The
-- regex is checked before the cast (case), so a junk topic is false, not an error.
create or replace function turnering.rt_topic_ok(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_topic ~* '^t:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:(cheer|presence))?$'
      then exists (
        select 1 from turnering.tournaments
        where id = substr(p_topic, 3, 36)::uuid
      )
    else false
  end
$$;

revoke all on function turnering.rt_topic_ok(text) from public;
grant execute on function turnering.rt_topic_ok(text) to anon, authenticated, service_role;

-- 2. grants + policies on realtime.messages ------------------------------------
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent (test harness) — skipping Realtime grants/policies';
    return;
  end if;

  execute 'grant usage on schema realtime to anon, authenticated';
  execute 'grant select, insert on realtime.messages to anon, authenticated';

  -- RECEIVE (broadcast + presence) on all three topic shapes.
  execute 'drop policy if exists "turnering_rt_receive" on realtime.messages';
  execute $p$
    create policy "turnering_rt_receive"
      on realtime.messages
      for select
      to anon, authenticated
      using (
        realtime.topic() like 't:%'
        and turnering.rt_topic_ok(realtime.topic())
      )
  $p$;

  -- SEND cheers: broadcast on t:<id>:cheer only.
  execute 'drop policy if exists "turnering_rt_cheer_send" on realtime.messages';
  execute $p$
    create policy "turnering_rt_cheer_send"
      on realtime.messages
      for insert
      to anon, authenticated
      with check (
        realtime.topic() like 't:%:cheer'
        and realtime.messages.extension = 'broadcast'
        and turnering.rt_topic_ok(realtime.topic())
      )
  $p$;

  -- TRACK presence: presence on t:<id>:presence only.
  execute 'drop policy if exists "turnering_rt_presence_send" on realtime.messages';
  execute $p$
    create policy "turnering_rt_presence_send"
      on realtime.messages
      for insert
      to anon, authenticated
      with check (
        realtime.topic() like 't:%:presence'
        and realtime.messages.extension = 'presence'
        and turnering.rt_topic_ok(realtime.topic())
      )
  $p$;

  -- NO insert policy for the bare t:<id> topic → forged client hints are
  -- denied by default-deny RLS.
end $$;
