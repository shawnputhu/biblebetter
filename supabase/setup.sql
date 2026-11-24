-- BibleBetter database setup — paste into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.

-- 1. One table holds every synced record. Each row belongs to the signed-in user only.
create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null,
  id text not null,
  data jsonb not null,
  updated_at bigint not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, id)
);
create index if not exists records_user_server_updated on public.records (user_id, server_updated_at);

-- 2. Newest change wins; every write gets a fresh server time so other devices can pull it.
create or replace function public.records_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old; -- an older change arrived late: keep the newer one
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists records_guard on public.records;
create trigger records_guard before insert or update on public.records
for each row execute function public.records_guard();

-- 3. Row-level security: you can only ever see and change your own rows.
alter table public.records enable row level security;
drop policy if exists "own rows select" on public.records;
drop policy if exists "own rows insert" on public.records;
drop policy if exists "own rows update" on public.records;
drop policy if exists "own rows delete" on public.records;
create policy "own rows select" on public.records for select to authenticated using (auth.uid() = user_id);
create policy "own rows insert" on public.records for insert to authenticated with check (auth.uid() = user_id);
create policy "own rows update" on public.records for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows delete" on public.records for delete to authenticated using (auth.uid() = user_id);

-- 4. Private storage for weekly backup snapshots (each user's files live in a folder named by their id).
insert into storage.buckets (id, name, public) values ('backups', 'backups', false)
on conflict (id) do nothing;

drop policy if exists "own backups select" on storage.objects;
drop policy if exists "own backups insert" on storage.objects;
drop policy if exists "own backups update" on storage.objects;
drop policy if exists "own backups delete" on storage.objects;
create policy "own backups select" on storage.objects for select to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own backups insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own backups update" on storage.objects for update to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own backups delete" on storage.objects for delete to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);
