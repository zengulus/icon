-- Durable tactical state is intentionally append-only. Render is the only
-- writer for checkpoints; authenticated browsers can create encounter metadata
-- but cannot write the live room or checkpoint payloads.

alter table public.encounters
  add column if not exists room_schema_version integer not null default 2,
  add column if not exists latest_checkpoint_revision bigint not null default 0,
  add column if not exists latest_encounter_revision bigint not null default 0;

create table if not exists public.encounter_checkpoints (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters(id) on delete cascade,
  room_revision bigint not null check (room_revision >= 0),
  encounter_revision bigint not null check (encounter_revision >= 0),
  schema_version integer not null check (schema_version > 0),
  reason text not null check (char_length(reason) between 1 and 80),
  state jsonb not null,
  created_at timestamptz not null default now(),
  constraint encounter_checkpoint_state_object check (jsonb_typeof(state) = 'object'),
  constraint encounter_checkpoint_reason check (reason in (
    'quiet', 'max-dirty-age', 'operation-count', 'retry', 'eviction',
    'semantic', 'encounter-start', 'round-transition', 'encounter-end',
    'hard-save', 'recovery'
  )),
  constraint encounter_checkpoint_revision_unique unique (encounter_id, room_revision)
);

create index if not exists encounter_checkpoints_latest_idx
  on public.encounter_checkpoints (encounter_id, room_revision desc);

-- One transaction makes a checkpoint both append-only and atomically current.
-- This function is invoked only by Render with its service-role credential.
create or replace function public.append_encounter_checkpoint(
  p_encounter_id uuid,
  p_room_revision bigint,
  p_encounter_revision bigint,
  p_schema_version integer,
  p_reason text,
  p_state jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Refuse a malformed or internally inconsistent snapshot even when Render
  -- itself is the caller. The checkpoint metadata must describe exactly the
  -- serialized VttRoomState that was acknowledged.
  if jsonb_typeof(p_state) <> 'object'
    or coalesce((p_state ->> 'schemaVersion')::integer, -1) <> p_schema_version
    or coalesce((p_state ->> 'revision')::bigint, -1) <> p_room_revision
    or coalesce((p_state -> 'encounter' ->> 'revision')::bigint, -1) <> p_encounter_revision
    or coalesce(p_state -> 'encounter' ->> 'id', '') <> p_encounter_id::text then
    raise exception 'Checkpoint metadata does not match its VttRoomState payload';
  end if;

  insert into public.encounter_checkpoints (
    encounter_id,
    room_revision,
    encounter_revision,
    schema_version,
    reason,
    state
  ) values (
    p_encounter_id,
    p_room_revision,
    p_encounter_revision,
    p_schema_version,
    p_reason,
    p_state
  ) on conflict (encounter_id, room_revision) do nothing;

  -- A duplicate is only an idempotent retry when it represents the exact same
  -- immutable save point. The scheduler reason is intentionally excluded:
  -- after a transport timeout the same snapshot may be retried as `retry` or
  -- `hard-save`, while the already-committed immutable row retains its first
  -- reason. Do not let a second process overwrite the encounter pointer with
  -- divergent JSON that happened to claim the same revision.
  if not exists (
    select 1
    from public.encounter_checkpoints
    where encounter_id = p_encounter_id
      and room_revision = p_room_revision
      and encounter_revision = p_encounter_revision
      and schema_version = p_schema_version
      and state = p_state
  ) then
    raise exception 'Checkpoint revision conflicts with a different durable snapshot';
  end if;

  update public.encounters
  set
    state = p_state,
    revision = p_room_revision,
    room_schema_version = p_schema_version,
    latest_checkpoint_revision = p_room_revision,
    latest_encounter_revision = p_encounter_revision,
    updated_at = now()
  where id = p_encounter_id
    and latest_checkpoint_revision <= p_room_revision;

  if not found then
    raise exception 'Encounter % was not found or has a newer checkpoint', p_encounter_id;
  end if;

  -- Full snapshots are deliberately not an unbounded operation log. Retain a
  -- bounded, useful mix of automatic and meaningful save points; encounter
  -- start/end records remain as single lifecycle boundaries. The current
  -- pointer was advanced above before this pruning begins, so it can never be
  -- removed here. With these caps every room has at most 234 checkpoints,
  -- which also bounds cold-recovery validation work.
  delete from public.encounter_checkpoints as stale
  where stale.encounter_id = p_encounter_id
    and stale.id in (
      select ranked.id
      from (
        select id, bucket, row_number() over (partition by bucket order by room_revision desc) as row_number
        from (
          select id, room_revision,
            case
              when reason in ('quiet', 'max-dirty-age', 'operation-count', 'retry', 'eviction') then 'automatic'
              when reason in ('semantic', 'round-transition', 'hard-save') then 'meaningful'
              when reason = 'recovery' then 'recovery'
              when reason in ('encounter-start', 'encounter-end') then reason
            end as bucket
          from public.encounter_checkpoints
          where encounter_id = p_encounter_id
        ) as bucketed
      ) as ranked
      where ranked.row_number > case ranked.bucket
        when 'automatic' then 24
        when 'meaningful' then 192
        when 'recovery' then 16
        when 'encounter-start' then 1
        when 'encounter-end' then 1
      end
    );
end;
$$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Without an
-- explicit revoke, any authenticated browser could call this SECURITY DEFINER
-- RPC and manufacture a checkpoint despite table-level RLS. Render calls it
-- with the Supabase service-role credential only.
revoke execute on function public.append_encounter_checkpoint(uuid, bigint, bigint, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_encounter_checkpoint(uuid, bigint, bigint, integer, text, jsonb)
  to service_role;

-- Corrupt-head recovery does not repoint an encounter backward. Render loads
-- the older, validated snapshot, rebases its room revision above the corrupt
-- head, and appends it through the function above with reason `recovery`.
-- That keeps the bad row available for audit and prevents the next command
-- from colliding with the corrupt revision.

alter table public.encounter_checkpoints enable row level security;

-- Render loads immutable checkpoint rows through its service role. State is
-- never granted to browser roles, including through an accidental default
-- table privilege.
revoke all on table public.encounter_checkpoints from public, anon, authenticated;
grant select on table public.encounter_checkpoints to service_role;

-- The prior policy allowed any campaign GM to write the state column from a
-- browser, creating dual live authority with Render. Service-role calls used by
-- Render bypass RLS and remain the sole checkpoint writer.
drop policy if exists "gms update encounters" on public.encounters;

-- Checkpoint payloads can hold hidden actors, fog geometry, and GM notes.
-- Do not rely on a React view to hide that data: authenticated browsers may
-- read only metadata needed to list/open encounters. Render's service role is
-- intentionally not affected and obtains the complete state through its own
-- server credential.
revoke all on table public.encounters from anon, authenticated;
grant select (
  id,
  campaign_id,
  name,
  rules_version,
  schema_version,
  room_schema_version,
  revision,
  latest_checkpoint_revision,
  latest_encounter_revision,
  created_by,
  created_at,
  updated_at
) on table public.encounters to authenticated;
grant insert (
  id,
  campaign_id,
  name,
  rules_version,
  schema_version,
  room_schema_version,
  created_by
) on table public.encounters to authenticated;

-- Campaign members may still read encounter metadata through the existing
-- encounter policy. Checkpoint snapshots can contain GM-hidden state and are
-- never directly exposed through PostgREST; Render applies role-specific views.
