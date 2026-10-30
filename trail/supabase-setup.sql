-- Trail Planner: Saved routes sync. Run once in Supabase → SQL Editor → New query → Run.
-- Every row belongs to the signed-in user (user_id defaults to auth.uid()); RLS lets each user see and change only their own rows.

create table if not exists public.folders (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data        jsonb,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create table if not exists public.routes (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data        jsonb,
  folder_id   text,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create index if not exists routes_user_idx  on public.routes  (user_id, updated_at);
create index if not exists folders_user_idx on public.folders (user_id, updated_at);

alter table public.routes  enable row level security;
alter table public.folders enable row level security;

-- routes: own rows only
drop policy if exists "routes select own" on public.routes;
drop policy if exists "routes insert own" on public.routes;
drop policy if exists "routes update own" on public.routes;
drop policy if exists "routes delete own" on public.routes;
create policy "routes select own" on public.routes for select to authenticated using (user_id = auth.uid());
create policy "routes insert own" on public.routes for insert to authenticated with check (user_id = auth.uid());
create policy "routes update own" on public.routes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "routes delete own" on public.routes for delete to authenticated using (user_id = auth.uid());

-- folders: own rows only
drop policy if exists "folders select own" on public.folders;
drop policy if exists "folders insert own" on public.folders;
drop policy if exists "folders update own" on public.folders;
drop policy if exists "folders delete own" on public.folders;
create policy "folders select own" on public.folders for select to authenticated using (user_id = auth.uid());
create policy "folders insert own" on public.folders for insert to authenticated with check (user_id = auth.uid());
create policy "folders update own" on public.folders for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "folders delete own" on public.folders for delete to authenticated using (user_id = auth.uid());

-- live updates between devices (optional; the app also syncs on load and when the tab regains focus)
do $$ begin
  begin alter publication supabase_realtime add table public.routes;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.folders; exception when duplicate_object then null; end;
end $$;
