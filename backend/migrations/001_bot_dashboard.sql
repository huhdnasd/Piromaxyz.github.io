create table if not exists public.bot_dashboard_status (
    id text primary key check (id = 'primary'),
    online boolean not null default false,
    started_at timestamptz not null,
    last_heartbeat timestamptz not null
);

create table if not exists public.bot_dashboard_guilds (
    guild_id text primary key check (guild_id ~ '^[0-9]{17,20}$'),
    guild_name text not null check (char_length(guild_name) <= 100),
    member_count integer not null check (member_count >= 0),
    updated_at timestamptz not null default now()
);

create table if not exists public.bot_dashboard_settings (
    id text primary key check (id = 'primary'),
    settings jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

create table if not exists public.bot_dashboard_logs (
    id bigint generated always as identity primary key,
    level text not null check (level in ('debug', 'info', 'warn', 'error')),
    message text not null check (char_length(message) <= 2000),
    created_at timestamptz not null default now()
);

create index if not exists bot_dashboard_logs_created_at_idx
    on public.bot_dashboard_logs (created_at desc);

create table if not exists public.bot_dashboard_commands (
    id uuid primary key,
    command text not null check (command ~ '^[a-z][a-z0-9:_-]{0,63}$'),
    arguments jsonb not null default '{}'::jsonb,
    requested_by text not null check (requested_by ~ '^[0-9]{17,20}$'),
    status text not null check (status in ('pending', 'completed', 'failed')),
    result jsonb,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

alter table public.bot_dashboard_status enable row level security;
alter table public.bot_dashboard_guilds enable row level security;
alter table public.bot_dashboard_settings enable row level security;
alter table public.bot_dashboard_logs enable row level security;
alter table public.bot_dashboard_commands enable row level security;

revoke all on public.bot_dashboard_status from anon, authenticated;
revoke all on public.bot_dashboard_guilds from anon, authenticated;
revoke all on public.bot_dashboard_settings from anon, authenticated;
revoke all on public.bot_dashboard_logs from anon, authenticated;
revoke all on public.bot_dashboard_commands from anon, authenticated;

insert into public.bot_dashboard_settings (id, settings)
values ('primary', '{}'::jsonb)
on conflict (id) do nothing;
