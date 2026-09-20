begin;

alter table public.app_state add column if not exists workspace_id uuid;
update public.app_state set workspace_id = gen_random_uuid() where workspace_id is null;
alter table public.app_state alter column workspace_id set not null;
alter table public.app_state drop constraint if exists app_state_pkey;
alter table public.app_state add constraint app_state_pkey primary key (workspace_id, year);

drop policy if exists "public insert app_state" on public.app_state;
drop policy if exists "public read app_state" on public.app_state;
drop policy if exists "public update app_state" on public.app_state;
drop policy if exists "workspace read app_state" on public.app_state;
drop policy if exists "workspace insert app_state" on public.app_state;
drop policy if exists "workspace update app_state" on public.app_state;

create policy "workspace read app_state" on public.app_state
for select to anon, authenticated
using (workspace_id::text = coalesce((select current_setting('request.headers', true)::jsonb ->> 'x-workspace-id'), ''));

create policy "workspace insert app_state" on public.app_state
for insert to anon, authenticated
with check (workspace_id::text = coalesce((select current_setting('request.headers', true)::jsonb ->> 'x-workspace-id'), ''));

create policy "workspace update app_state" on public.app_state
for update to anon, authenticated
using (workspace_id::text = coalesce((select current_setting('request.headers', true)::jsonb ->> 'x-workspace-id'), ''))
with check (workspace_id::text = coalesce((select current_setting('request.headers', true)::jsonb ->> 'x-workspace-id'), ''));

revoke all on table public.app_state from anon, authenticated;
grant select, insert, update on table public.app_state to anon, authenticated;

commit;
