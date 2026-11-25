-- BibleBetter Phase 3: reminders. Paste into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once. (Supabase may warn about "destructive operations" because of the
-- "drop policy if exists" lines — they only replace BibleBetter's own rules.)

-- 1. Each device that turns on notifications is stored here, with its reminder times.
create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sub jsonb not null,
  prefs jsonb not null default '{}',
  tz text,
  last_sent jsonb not null default '{}',
  snooze jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "own subs select" on public.push_subs;
drop policy if exists "own subs insert" on public.push_subs;
drop policy if exists "own subs update" on public.push_subs;
drop policy if exists "own subs delete" on public.push_subs;
create policy "own subs select" on public.push_subs for select to authenticated using (auth.uid() = user_id);
create policy "own subs insert" on public.push_subs for insert to authenticated with check (auth.uid() = user_id);
create policy "own subs update" on public.push_subs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own subs delete" on public.push_subs for delete to authenticated using (auth.uid() = user_id);
grant select, insert, update, delete on public.push_subs to authenticated;
grant all on public.push_subs to service_role;
grant select on public.records to service_role;

-- 2. Private keys for the reminders function (only the server can read this table).
create table if not exists public.bb_secrets (key text primary key, value text not null);
alter table public.bb_secrets enable row level security; -- no policies: app users can never read it
grant all on public.bb_secrets to service_role;
insert into public.bb_secrets (key, value)
values ('cron', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- 3. Run the reminders function every 5 minutes.
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'biblebetter-reminders';
select cron.schedule('biblebetter-reminders', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://ucpyjdeggwtrumjlqbup.supabase.co/functions/v1/reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron', (select value from public.bb_secrets where key = 'cron')),
    body := '{}'::jsonb
  );
$$);
