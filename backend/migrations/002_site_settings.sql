create table if not exists public.site_settings (
    id text primary key check (id = 'public'),
    settings jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

revoke all on public.site_settings from anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant update on public.site_settings to authenticated;

drop policy if exists site_settings_public_read on public.site_settings;
create policy site_settings_public_read
    on public.site_settings
    for select
    to anon, authenticated
    using (id = 'public');

drop policy if exists site_settings_admin_update on public.site_settings;
create policy site_settings_admin_update
    on public.site_settings
    for update
    to authenticated
    using (id = 'public' and auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
    with check (id = 'public' and auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

insert into public.site_settings (id, settings)
values ('public', '{}'::jsonb)
on conflict (id) do nothing;