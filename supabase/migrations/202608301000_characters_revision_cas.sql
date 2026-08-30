-- Add a durable per-character revision used for local-first compare-and-set
-- cloud replication. `revision` is monotonic and NEVER moves backward: a late
-- or stale cloud write (older revision arriving after a newer one was
-- accepted) must not overwrite the newer row, and repeating the exact current
-- revision must be a harmless no-op.
--
-- This migration is additive. It does not bump the RLS policies, remove the
-- plain `owner_id` filter, or change how existing rows are read.

alter table public.characters
  add column if not exists revision bigint not null default 1;

create or replace function public.save_character_cas(
  target_id uuid,
  target_owner uuid,
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
begin
  if auth.uid() is null then
    -- The RPC is called only by the local-first client while signed in, and a
    -- definer function must never mutate cloud rows for an unauthenticated
    -- caller.
    raise exception 'not authenticated';
  end if;

  -- Same compare-and-set decision the client applies locally so both sides
  -- agree. A repeated current revision is a no-op (returns the current value);
  -- a stale/older revision is rejected and cannot regress the row.
  select c.revision into existing_revision
    from public.characters as c
   where c.id = target_id
     and c.owner_id = target_owner
   for update;

  if existing_revision is null then
    insert into public.characters(id, owner_id, name, rules_version, schema_version, data, revision)
    values (target_id, target_owner, target_name, target_rules_version, target_schema_version, target_data, target_revision)
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
         data = target_data,
         revision = target_revision,
         updated_at = now()
   where id = target_id
     and owner_id = target_owner
  returning revision into result_revision;

  if result_revision is null then
    raise exception 'character not found for owner';
  end if;

  return result_revision;
end;
$$;

revoke all on function public.save_character_cas(uuid, uuid, text, text, integer, jsonb, bigint) from public;