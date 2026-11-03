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

## Live Discord bot dashboard

The public `/status.html` page now includes live bot availability, current-process uptime, and member counts for explicitly approved Discord servers. The existing Supabase site content, status cards, and `/admin.html` editor remain in place. The separate `/bot-admin.html` page uses Discord OAuth2; the backend verifies the returned Discord user ID against `OWNER_DISCORD_ID` before creating an owner session. An unlisted URL is not access control.

The website repository does not contain the bot source. The `backend/bot-connector.example.js` file is a transport example, not a drop-in integration: the bot project must connect its existing client, settings store, logs, and explicitly approved command handlers to its callback interface.

### 1. Configure Supabase storage

Run [`backend/migrations/001_bot_dashboard.sql`](./backend/migrations/001_bot_dashboard.sql) in the Supabase SQL editor. These dashboard tables have row-level security enabled and no access for the public or authenticated browser roles. The backend accesses them with the Supabase service-role key; that key must only be stored in the backend host's secret manager.

Do not use the existing public anon key as the backend service-role key. Do not copy the service-role key, Discord client secret, session secret, or bot connection secret into frontend files, this repository, or bot source code.

### 2. Configure and host the API

The backend is a Node.js 22+ service in [`backend/`](./backend/). It must run as one instance on a host that supports HTTPS and WebSockets. Configure the `backend/.env.example` variables in that host's secret/environment settings, using:

- `PUBLIC_ORIGIN=https://piroma.xyz`
- `API_PUBLIC_URL=https://api.piroma.xyz`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Supabase
- `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` from a Discord OAuth2 application
- `OWNER_DISCORD_ID` as your Discord user ID
- `APPROVED_GUILD_IDS` as comma-separated Discord server IDs
- independently generated values of at least 32 characters for `SESSION_SECRET` and `BOT_CONNECTION_SECRET`

In Discord, enable Developer Mode to copy your user ID for `OWNER_DISCORD_ID` and the server IDs for `APPROVED_GUILD_IDS`. Generate each secret separately, for example by running `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"` twice. Create DNS and TLS for `api.piroma.xyz` to point to the host you choose. In the Discord Developer Portal, add this exact OAuth redirect URL: `https://api.piroma.xyz/auth/discord/callback`. The OAuth scope needed is only `identify`. The `https://api.piroma.xyz` URL in `js/bot-dashboard-config.js` is public configuration, not a secret; update it if you choose a different API hostname.

For local development only, copy `backend/.env.example` to `backend/.env`, fill in real values, then run `npm install` and `npm start` from `backend/`. Never commit `.env`. The hosted service must be running before the website or bot can fetch status. No deployment has been performed by this setup.

#### Render setup

[`render.yaml`](./render.yaml) is a Render Blueprint for a single Node web service on Render's **Free** plan, with auto-deploy on later Git pushes disabled and a `/healthz` health check. This is a hobby/test setup, not a reliability guarantee. Free web services sleep after 15 minutes without inbound traffic; the bot's 15-second WebSocket heartbeat should keep the service active while the bot is connected. If the bot is disconnected long enough, Render may sleep the service; the next request or bot connection can take about a minute to wake it. Render's 750 free instance hours are shared across your workspace, so other free services use the same allowance and exhausting it suspends free services until the next month. Render Blueprints can provision services when you apply them; this repository only contains the configuration and has not connected to or deployed to Render. Check the current Render limits before creating resources.

1. Get the prepared changes in this repository's GitHub repo. They are currently only in a local clone, so Render cannot see `render.yaml` or the backend yet. Safest is to create a branch, commit and push it, then open a pull request and merge it after reviewing the diff. Do not commit `backend/.env` or any secrets.
2. Run the Supabase SQL migration above before starting the service.
3. Connect the GitHub repository in Render and use the Blueprint flow to apply `render.yaml`. The Node API lives in `backend/`; do not create a static site for it.
4. Add `api.piroma.xyz` as a custom domain to the new Render web service. In your DNS provider, create the CNAME Render tells you to use for `api.piroma.xyz`; wait until Render verifies the domain and provisions HTTPS. Do not change the existing apex `piroma.xyz` DNS/GitHub Pages configuration.
5. In the Render service's Environment settings, set `API_PUBLIC_URL` to `https://api.piroma.xyz`, then add the Discord, Supabase, owner ID, approved server IDs, and independently generated session/connection secrets listed above. Keep the two secret values private. `render.yaml` marks these values `sync: false` so they are not stored in Git. For `BOT_ALLOWED_COMMANDS`, begin with an empty value.
6. In Discord Developer Portal, set the OAuth redirect to `https://api.piroma.xyz/auth/discord/callback`. The service must have the custom domain and `API_PUBLIC_URL` configured before completing the OAuth flow.
7. Deploy the service from the Render dashboard only after reviewing its environment. Verify `https://api.piroma.xyz/healthz`. Update `js/bot-dashboard-config.js` only if you choose an API hostname other than `api.piroma.xyz`.

The backend holds the bot WebSocket and pending commands in memory, so keep exactly one Render instance and do not enable autoscaling. The Free plan can work for testing while your bot's regular WebSocket heartbeats keep it active, but it can sleep when the bot is disconnected and is subject to workspace-shared free-hour limits. Automatic deploys are disabled in the Blueprint so you can review website/backend changes before requesting each deployment.

### 3. Connect the bot computer outbound

On the computer that runs the bot, add the `ws` package to the bot project and copy/adapt `backend/bot-connector.example.js` there. Keep the bot connection secret in a local environment variable or OS secret store (not in source control), and pass it as `connectionSecret`. Call `startDashboardConnector` after the existing Discord client is ready and provide:

- `apiUrl`: `https://api.piroma.xyz`
- `allowedCommands`: the exact command names implemented and approved by the bot
- `getGuilds()`: return `{ id, name, memberCount }` for each guild
- `getUptimeMs()`: return the current bot process uptime in milliseconds
- `applySettings(settings)`: validate and apply only the settings your bot supports
- `runCommand(name, arguments)`: dispatch only to existing, explicitly allowlisted bot handlers; never execute shell commands, `eval`, or arbitrary code

On Windows, enable the Discord Developer Portal's **Server Members Intent** and the corresponding privileged gateway intent in the bot if your implementation needs accurate member counts. Set the connector secret in the computer's environment rather than in source code. It retries the outbound secure WebSocket connection, so the computer does not need an open inbound port or a public IP.

Configure `BOT_ALLOWED_COMMANDS` on the API host with exactly the same comma-separated command names as the bot adapter. It is empty by default, so no remote command can run until both sides are configured. Dashboard settings are JSON data only; secret-like field names are rejected. Logs and command history are automatically pruned after 30 and 90 days by default; configure `BOT_LOG_RETENTION_DAYS` and `BOT_COMMAND_RETENTION_DAYS` to change those periods. The backend redacts common secret patterns from logs and results, but the bot must still avoid logging credentials or private data it should not transmit.

### 4. Verify before opening access

After you configure and start the services:

1. Check `https://api.piroma.xyz/healthz`.
2. Start the bot process and confirm its outbound connection appears as online at `/status.html`.
3. Sign in at `/bot-admin.html` with the configured owner Discord account; test settings and only a harmless, explicitly allowlisted command.
4. Sign in with a different Discord account and confirm it is denied.
5. Confirm the site still reads and updates its existing Supabase content through `/admin.html`.