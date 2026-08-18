create extension if not exists pgcrypto;

create type public.campaign_role as enum ('gm', 'player');

create table public.characters (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Unnamed Icon',
  rules_version text not null default '1.5',
  schema_version integer not null default 1,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint character_data_object check (jsonb_typeof(data) = 'object')
);

create index characters_owner_updated_idx on public.characters(owner_id, updated_at desc);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_members (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.campaign_role not null default 'player',
  joined_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

create table public.encounters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  rules_version text not null default '1.5',
  schema_version integer not null default 1,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint encounter_state_object check (jsonb_typeof(state) = 'object')
);

create index encounters_campaign_updated_idx on public.encounters(campaign_id, updated_at desc);

create or replace function public.is_campaign_member(target_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.campaign_members
    where campaign_id = target_campaign and user_id = auth.uid()
  );
$$;

create or replace function public.is_campaign_gm(target_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.campaign_members
    where campaign_id = target_campaign and user_id = auth.uid() and role = 'gm'
  );
$$;

create or replace function public.add_campaign_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.campaign_members(campaign_id, user_id, role) values (new.id, new.owner_id, 'gm');
  return new;
end;
$$;

create trigger campaign_owner_membership
after insert on public.campaigns
for each row execute function public.add_campaign_owner_membership();

alter table public.characters enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.encounters enable row level security;

create policy "owners manage characters" on public.characters
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "members view campaigns" on public.campaigns
for select using (public.is_campaign_member(id) or owner_id = auth.uid());
create policy "owners create campaigns" on public.campaigns
for insert with check (owner_id = auth.uid());
create policy "owners update campaigns" on public.campaigns
for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners delete campaigns" on public.campaigns
for delete using (owner_id = auth.uid());

create policy "members view membership" on public.campaign_members
for select using (public.is_campaign_member(campaign_id));
create policy "gms add members" on public.campaign_members
for insert with check (public.is_campaign_gm(campaign_id));
create policy "gms update members" on public.campaign_members
for update using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id));
create policy "gms remove members" on public.campaign_members
for delete using (public.is_campaign_gm(campaign_id) or user_id = auth.uid());

create policy "members view encounters" on public.encounters
for select using (public.is_campaign_member(campaign_id));
create policy "gms create encounters" on public.encounters
for insert with check (public.is_campaign_gm(campaign_id) and created_by = auth.uid());
create policy "gms update encounters" on public.encounters
for update using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id));
create policy "gms delete encounters" on public.encounters
for delete using (public.is_campaign_gm(campaign_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('icon-assets', 'icon-assets', true, 52428800, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

create policy "public reads icon assets" on storage.objects
for select using (bucket_id = 'icon-assets');
create policy "users upload to own asset folder" on storage.objects
for insert to authenticated with check (bucket_id = 'icon-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own assets" on storage.objects
for update to authenticated using (bucket_id = 'icon-assets' and owner_id = auth.uid()::text);
create policy "users delete own assets" on storage.objects
for delete to authenticated using (bucket_id = 'icon-assets' and owner_id = auth.uid()::text);
