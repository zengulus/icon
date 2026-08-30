-- ICON CONNECT identity: username profiles, cryptographically bound player
-- instances, and creator-instance character ownership.
--
-- Principles (additive migration; historical files are never edited):
-- * player_profiles holds the username (normalized for uniqueness, display
--   casing preserved separately). The internal Supabase Auth email is an
--   opaque HMAC-derived locator that never appears in this schema and is
--   never exposed to clients.
-- * user_instances is the authoritative instance -> backend-user binding.
--   Only the trusted Render server (service role / connect_bind_instance)
--   writes it; browsers may read only their own rows.
-- * characters.creator_instance_id records which player instance created a
--   character. Cloud create/upsert (save_character_cas) requires that the
--   creator instance belongs to the authenticated session owner, so a client
--   can never claim another account's characters by editing ownerId,
--   creator_instance_id, or username.

create table public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username_normalized text not null,
  username_display text not null,
  created_at timestamptz not null default now(),
  constraint player_profiles_username_unique unique (username_normalized),
  constraint player_profiles_username_format check (username_normalized ~ '^[a-z0-9_-]{3,32}$')
);

create table public.user_instances (
  instance_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  public_key jsonb not null,
  bound_at timestamptz not null default now(),
  revoked_at timestamptz null,
  constraint user_instances_public_key_object check (jsonb_typeof(public_key) = 'object')
);

create index user_instances_user_idx on public.user_instances(user_id);

alter table public.characters
  add column if not exists creator_instance_id uuid;

create index if not exists characters_creator_instance_idx
  on public.characters(creator_instance_id);

-- RLS + grants: a player may read only their own profile and their own
-- bound instances. Anonymous callers get nothing, and no caller can
-- enumerate other users' usernames or instance relationships. Writes to
-- both tables are server-mediated only (service role / connect_bind_instance).
alter table public.player_profiles enable row level security;
alter table public.user_instances enable row level security;

revoke all on table public.player_profiles from anon, authenticated;
revoke all on table public.user_instances from anon, authenticated;
grant select on table public.player_profiles to authenticated;
grant select on table public.user_instances to authenticated;

create policy "players view own profile" on public.player_profiles
for select using (user_id = auth.uid());

create policy "players view own instances" on public.user_instances
for select using (user_id = auth.uid());

-- One transaction creates the profile AND the instance binding together.
-- The unique constraints are the final authority against races on username
-- and instance; the server maps their violations to generic errors and
-- cleans up the auth user if this step fails.
create or replace function public.connect_bind_instance(
  p_user_id uuid,
  p_username_normalized text,
  p_username_display text,
  p_instance_id uuid,
  p_public_key jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if jsonb_typeof(p_public_key) <> 'object' then
    raise exception 'invalid public key';
  end if;
  insert into public.player_profiles(user_id, username_normalized, username_display)
  values (p_user_id, p_username_normalized, p_username_display);
  insert into public.user_instances(instance_id, user_id, public_key)
  values (p_instance_id, p_user_id, p_public_key);
end;
$$;

revoke all on function public.connect_bind_instance(uuid, text, text, uuid, jsonb) from public;

-- The client writes characters ONLY through save_character_cas. Remove the
-- direct browser write grants so a client can never insert/update a row by
-- editing owner_id or creator_instance_id fields; owners keep read access
-- through RLS.
revoke all on table public.characters from anon, authenticated;
grant select on table public.characters to authenticated;

-- Hardened compare-and-set save. The owner is derived from the session
-- (auth.uid()), never from client JSON, and the creator instance must be
-- bound to that owner and not revoked. A bound instance can therefore never
-- be used to upsert under a different account.
create or replace function public.save_character_cas(
  target_id uuid,
  target_creator_instance_id uuid,
  target_name text,
  target_rules_version text,
  target_schema_version integer,
  target_data jsonb,
  target_revision bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_revision bigint;
  result_revision bigint;
  session_user uuid := auth.uid();
  bound_user uuid;
begin
  if session_user is null then
    -- The RPC is called only by the local-first client while signed in, and a
    -- definer function must never mutate cloud rows for an unauthenticated
    -- caller.
    raise exception 'not authenticated';
  end if;

  -- Creator-instance ownership gate: the character's creator instance must be
  -- bound to this exact authenticated user and not revoked. This is the
  -- durable authority behind "changing local JSON cannot transfer ownership".
  select ui.user_id into bound_user
    from public.user_instances as ui
   where ui.instance_id = target_creator_instance_id
     and ui.revoked_at is null;
  if bound_user is null or bound_user <> session_user then
    raise exception 'creator instance is not bound to this account';
  end if;

  select c.revision into existing_revision
    from public.characters as c
   where c.id = target_id
     and c.owner_id = session_user
   for update;

  if existing_revision is null then
    insert into public.characters(id, owner_id, creator_instance_id, name, rules_version, schema_version, data, revision)
    values (
      target_id,
      session_user,
      target_creator_instance_id,
      target_name,
      target_rules_version,
      target_schema_version,
      -- Never trust IconCharacter.ownerId from client JSON as authorization
      -- authority: the durable row owner is derived from the session.
      jsonb_set(coalesce(target_data, '{}'::jsonb), '{ownerId}', to_jsonb(session_user::text)),
      target_revision
    )
    returning revision into result_revision;
    return result_revision;
  end if;

  if existing_revision <> target_revision and target_revision < existing_revision then
    -- Late/stale write; never move the durable revision backward. The caller
    -- keeps its record pending and retries with its latest revision later.
    return existing_revision;
  end if;

  update public.characters
     set name = target_name,
         rules_version = target_rules_version,
         schema_version = target_schema_version,
         data = jsonb_set(coalesce(target_data, '{}'::jsonb), '{ownerId}', to_jsonb(session_user::text)),
         revision = target_revision,
         updated_at = now()
   where id = target_id
     and owner_id = session_user
  returning revision into result_revision;

  if result_revision is null then
    raise exception 'character not found for owner';
  end if;

  return result_revision;
end;
$$;

revoke all on function public.save_character_cas(uuid, uuid, text, text, integer, jsonb, bigint) from public;
