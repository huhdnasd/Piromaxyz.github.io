# Piromaxyz.github.io

## Private site administration

`admin.html` is intentionally not linked from public navigation or the sitemap. The page requires a Supabase email/password account with the `admin` app-metadata role. The database row-level security policy is the actual access control; the unlisted URL and `robots.txt` entry are not security barriers.

This static site needs a Supabase project for shared updates. In `js/site-data.js`, replace `YOUR-PROJECT` and `YOUR_SUPABASE_ANON_KEY` with the project's URL and public anon key. Never put a service-role key in this repository.

Run this SQL in the Supabase SQL editor:

```sql
create table public.site_settings (
	id text primary key check (id = 'public'),
	settings jsonb not null default '{}'::jsonb,
	updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;
grant select on public.site_settings to anon, authenticated;
grant update on public.site_settings to authenticated;

create policy "Public can read site settings"
	on public.site_settings for select
	using (true);

create policy "Admins can update site settings"
	on public.site_settings for update to authenticated
	using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
	with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

insert into public.site_settings (id, settings)
values (
	'public',
	'{"memberCount":487,"communityRating":4.6,"pricing":{"free":0,"premium":500,"ultimate":1000},"status":{"bot":"Online","api":"Online","database":"Online","discord":"Online"},"incident":"No incidents reported at this time.","reviews":[]}'::jsonb
);
```

In Supabase Authentication, create the admin user and set its **app metadata** to `{"role":"admin"}`. Use a strong password and enable multi-factor authentication in Supabase if available. After configuring the project, visit `/admin.html`, sign in, and save changes. Public pages read the same row, so updates are shared across visitors.