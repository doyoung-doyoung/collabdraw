-- CollabDraw Supabase Schema
-- Run this in your Supabase SQL editor

create table if not exists rooms (
  id text primary key,
  name text not null,
  host_id text not null,
  host_name text not null,
  password text default '',
  timer_seconds integer default 0,
  timer_started_at timestamptz,
  timer_paused boolean default false,
  timer_pause_used boolean default false,
  is_ended boolean default false,
  created_at timestamptz default now()
);

create table if not exists room_users (
  id text primary key,
  room_id text references rooms(id) on delete cascade,
  name text not null,
  color text not null,
  pixel_area bigint default 0,
  joined_at timestamptz default now()
);

create table if not exists strokes (
  id bigserial primary key,
  room_id text references rooms(id) on delete cascade,
  user_id text not null,
  user_color text not null,
  tool text not null,
  points jsonb not null,
  size integer not null,
  emoji text,
  created_at timestamptz default now()
);

create table if not exists comments (
  id bigserial primary key,
  room_id text references rooms(id) on delete cascade,
  user_id text not null,
  user_name text not null,
  user_color text not null,
  x float not null,
  y float not null,
  content text not null,
  created_at timestamptz default now()
);

create table if not exists chat_messages (
  id bigserial primary key,
  room_id text references rooms(id) on delete cascade,
  user_id text not null,
  user_name text not null,
  user_color text not null,
  emoji text not null,
  created_at timestamptz default now()
);

-- Enable Realtime for all tables
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table room_users;
alter publication supabase_realtime add table strokes;
alter publication supabase_realtime add table comments;
alter publication supabase_realtime add table chat_messages;

-- RLS: allow all (public drawing app)
alter table rooms enable row level security;
alter table room_users enable row level security;
alter table strokes enable row level security;
alter table comments enable row level security;
alter table chat_messages enable row level security;

create policy "public_all" on rooms for all using (true) with check (true);
create policy "public_all" on room_users for all using (true) with check (true);
create policy "public_all" on strokes for all using (true) with check (true);
create policy "public_all" on comments for all using (true) with check (true);
create policy "public_all" on chat_messages for all using (true) with check (true);

-- Migration for existing databases: add password column
-- alter table rooms add column if not exists password text default '';
