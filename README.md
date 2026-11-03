s# Piroma

Meet Piroma: your Discord server's behind-the-scenes teammate. It helps keep a community welcoming, organized, and easier to run, so moderators can spend less time on repetitive tasks and more time with their members.

## What Piroma does

- **Helps your moderators:** use tools like `/warn`, `/mute`, and `/ban` to respond to problems and keep your server on track.
- **Keeps support moving:** organize member requests with tickets, and close a ticket with `/ticket close`.
- **Makes server activity easier to follow:** use `/logs` to look up member activity and keep an eye on important events.
- **Helps you get started:** configure the bot with `/setup`, look up commands with `/help`, and set up verification with `/verification`.
- **Adds useful day-to-day tools:** use `/topic-change` to request a channel topic update.

Piroma brings moderation, support, logging, and automation together in one place. Whether you're handling a busy support queue or just want a little more order in your community, it's designed to make the routine parts of running a Discord server feel simpler.

## See Piroma in action

Browse the [commands](./commands.html) and [features](./features.html), or check the [live service status](./status.html). Need a hand? Visit the [Piroma support server](https://discord.gg/TvcK4Ak4zN).

## About this repository

This repository contains Piroma's website and live status and owner-dashboard services. The bot itself runs separately; this site describes the bot and provides its public-facing web tools.

## Admin site setup

The admin page and public site read settings from the `public.site_settings` table in Supabase. To create it, run [`backend/migrations/002_site_settings.sql`](backend/migrations/002_site_settings.sql) in the Supabase SQL Editor for the project configured in `js/site-data.js`.

The migration seeds the public settings row and permits public reads. Updates are restricted by row-level security to authenticated users whose `app_metadata.role` is `admin`. Set that app metadata on the admin account in Supabase before signing in. If the table was just created and the page still reports it is missing, refresh the Supabase API schema cache or wait briefly for it to reload.
