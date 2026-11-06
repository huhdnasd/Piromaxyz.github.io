drop policy if exists site_settings_admin_update on public.site_settings;
create policy site_settings_admin_update
    on public.site_settings
    for update
    to authenticated
    using (
        id = 'public'
        and (
            auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
            or lower(coalesce(auth.jwt() ->> 'email', '')) = 'tal.lewis30@gmail.com'
        )
    )
    with check (
        id = 'public'
        and (
            auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
            or lower(coalesce(auth.jwt() ->> 'email', '')) = 'tal.lewis30@gmail.com'
        )
    );