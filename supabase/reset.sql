-- Reset and configure database schema for timer chat room application
-- Run this script inside the `postgres` database of your Supabase project.
-- It recreates tables, relationships, RLS policies, and realtime publications
-- required by the application.

begin;

-- Clean up existing objects (order matters because of dependencies)
drop table if exists round_roles cascade;
drop table if exists rounds cascade;
drop table if exists messages cascade;
drop table if exists timers cascade;
drop table if exists room_scores cascade;
drop table if exists room_members cascade;
drop table if exists rooms cascade;
drop table if exists profiles cascade;
drop function if exists set_updated_at() cascade;

do $$ begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    create extension pgcrypto;
  end if;
end $$;

set search_path = public;

-- User profiles --------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);

-- Rooms ---------------------------------------------------------------------
create table rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index rooms_owner_idx on rooms (owner);

-- Room members ---------------------------------------------------------------
create table room_members (
  room_id uuid not null references rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_members_user_idx on room_members (user_id);

-- Room scores ---------------------------------------------------------------
create table room_scores (
  room_id uuid not null references rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  score integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_scores_room_idx on room_scores (room_id);
create index room_scores_user_idx on room_scores (user_id);

-- Messages ------------------------------------------------------------------
create table messages (
  id bigserial primary key,
  room_id uuid not null references rooms (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index messages_room_idx on messages (room_id);

-- Timers --------------------------------------------------------------------
create table timers (
  room_id uuid primary key references rooms (id) on delete cascade,
  deadline_at timestamptz,
  duration_seconds integer,
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger timers_set_updated_at
before update on timers
for each row execute procedure set_updated_at();

-- Rounds and roles ----------------------------------------------------------
create table rounds (
  id bigserial primary key,
  room_id uuid not null references rooms (id) on delete cascade,
  topic text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index rounds_room_idx on rounds (room_id);

create table round_roles (
  round_id bigint not null references rounds (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('presenter', 'insider', 'common')),
  assigned_at timestamptz not null default now(),
  primary key (round_id, user_id)
);
create index round_roles_user_idx on round_roles (user_id);

-- Row Level Security --------------------------------------------------------

alter table profiles enable row level security;
create policy "Profiles are viewable by their owner"
  on profiles for select
  using (auth.uid() = id);
create policy "Profiles are editable by their owner"
  on profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

alter table rooms enable row level security;
create policy "Room owners manage their rooms"
  on rooms for all
  using (auth.uid() = owner)
  with check (auth.uid() = owner);
create policy "Room members can view rooms"
  on rooms for select
  using (exists (
    select 1
    from room_members rm
    where rm.room_id = rooms.id
      and rm.user_id = auth.uid()
  ));

alter table room_members enable row level security;
create policy "Members can view fellow members"
  on room_members for select
  using (exists (
    select 1
    from room_members rm
    where rm.room_id = room_members.room_id
      and rm.user_id = auth.uid()
  ));
create policy "Users manage their own membership"
  on room_members for insert
  with check (auth.uid() = user_id);
create policy "Users update their own membership"
  on room_members for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Users can leave rooms"
  on room_members for delete
  using (auth.uid() = user_id);

alter table room_scores enable row level security;
create policy "Members can view scores"
  on room_scores for select
  using (exists (
    select 1
    from room_members rm
    where rm.room_id = room_scores.room_id
      and rm.user_id = auth.uid()
  ));
create policy "Room members can upsert scores"
  on room_scores for insert
  with check (
    exists (
      select 1
      from room_members rm
      where rm.room_id = room_scores.room_id
        and rm.user_id = room_scores.user_id
    )
    and exists (
      select 1
      from room_members rm
      where rm.room_id = room_scores.room_id
        and rm.user_id = auth.uid()
    )
  );
create policy "Room members can update scores"
  on room_scores for update
  using (exists (
    select 1
    from room_members rm
    where rm.room_id = room_scores.room_id
      and rm.user_id = auth.uid()
  ))
  with check (
    exists (
      select 1
      from room_members rm
      where rm.room_id = room_scores.room_id
        and rm.user_id = room_scores.user_id
    )
  );
create policy "Room members can delete scores"
  on room_scores for delete
  using (exists (
    select 1
    from room_members rm
    where rm.room_id = room_scores.room_id
      and rm.user_id = auth.uid()
  ));

alter table messages enable row level security;
create policy "Members can view room messages"
  on messages for select
  using (exists (
    select 1
    from room_members rm
    where rm.room_id = messages.room_id
      and rm.user_id = auth.uid()
  ));
create policy "Members can post messages"
  on messages for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from room_members rm
      where rm.room_id = messages.room_id
        and rm.user_id = auth.uid()
    )
  );

alter table timers enable row level security;
create policy "Members can view timers"
  on timers for select
  using (exists (
    select 1
    from room_members rm
    where rm.room_id = timers.room_id
      and rm.user_id = auth.uid()
  ));
create policy "Members can upsert timers"
  on timers for all
  using (exists (
    select 1
    from room_members rm
    where rm.room_id = timers.room_id
      and rm.user_id = auth.uid()
  ))
  with check (
    exists (
      select 1
      from room_members rm
      where rm.room_id = timers.room_id
        and rm.user_id = auth.uid()
    )
  );

alter table rounds enable row level security;
create policy "Room members can view rounds"
  on rounds for select
  using (exists (
    select 1
    from room_members rm
    where rm.room_id = rounds.room_id
      and rm.user_id = auth.uid()
  ));
create policy "Room members can insert rounds"
  on rounds for insert
  with check (
    auth.uid() = created_by
    and exists (
      select 1
      from room_members rm
      where rm.room_id = rounds.room_id
        and rm.user_id = auth.uid()
    )
  );

alter table round_roles enable row level security;
create policy "Room members can view round roles"
  on round_roles for select
  using (exists (
    select 1
    from rounds r
    join room_members rm on rm.room_id = r.room_id
    where r.id = round_roles.round_id
      and rm.user_id = auth.uid()
  ));
create policy "Room members can insert round roles"
  on round_roles for insert
  with check (
    exists (
      select 1
      from rounds r
      join room_members rm on rm.room_id = r.room_id
      where r.id = round_roles.round_id
        and rm.user_id = auth.uid()
    )
  );

-- Realtime publication ------------------------------------------------------
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table room_members;
alter publication supabase_realtime add table room_scores;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table timers;
alter publication supabase_realtime add table rounds;
alter publication supabase_realtime add table round_roles;

commit;
