-- Groovix jam sync — run this ONCE in Supabase → SQL Editor → New query → Run.
-- Creates the table the app reads/writes over HTTP for live jam rooms.

create table if not exists public.jam_members (
  room       text        not null,
  client_id  text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (room, client_id)
);

alter table public.jam_members enable row level security;

-- Allow the app's anon key to read/write jam rows (ephemeral session data).
drop policy if exists "jam anon all" on public.jam_members;
create policy "jam anon all" on public.jam_members
  for all
  to anon, authenticated
  using (true)
  with check (true);
