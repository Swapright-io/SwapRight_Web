create extension if not exists pgcrypto;

do $$ begin create type public.account_status as enum ('active', 'suspended', 'deleted'); exception when duplicate_object then null; end $$;
do $$ begin create type public.listing_type as enum ('free', 'for_sale'); exception when duplicate_object then null; end $$;
do $$ begin create type public.listing_condition as enum ('new', 'like_new', 'good', 'fair'); exception when duplicate_object then null; end $$;
do $$ begin create type public.listing_status as enum ('available', 'reserved', 'completed', 'withdrawn', 'hidden'); exception when duplicate_object then null; end $$;
do $$ begin create type public.reservation_status as enum ('pending', 'cancelled', 'expired', 'completed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.report_target as enum ('listing', 'message', 'user'); exception when duplicate_object then null; end $$;

create table public.university_domains (
  domain text primary key check (domain = lower(domain)),
  institution_name text not null,
  state text,
  country_code text not null default 'US' check (country_code = 'US'),
  source text not null,
  active boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  university_domain text references public.university_domains(domain),
  display_name text not null default '' check (char_length(display_name) <= 80),
  dorm_building text check (char_length(dorm_building) <= 120),
  avatar_path text,
  onboarding_complete boolean not null default false,
  status public.account_status not null default 'active',
  moderation_note text,
  suspended_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists university_domain text;
alter table public.profiles add column if not exists display_name text not null default '';
alter table public.profiles add column if not exists dorm_building text;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists onboarding_complete boolean not null default false;
alter table public.profiles add column if not exists moderation_note text;
alter table public.profiles add column if not exists suspended_until timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create index profiles_domain_idx on public.profiles(university_domain);
create index profiles_status_idx on public.profiles(status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger swapright_profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and (
    new.email is distinct from old.email or
    new.university_domain is distinct from old.university_domain or
    new.status is distinct from old.status or
    new.moderation_note is distinct from old.moderation_note or
    new.suspended_until is distinct from old.suspended_until
  ) then
    raise exception 'Protected profile fields can only be changed by an administrator';
  end if;
  return new;
end;
$$;

create trigger swapright_profiles_protect_security_fields
before update on public.profiles
for each row execute function public.protect_profile_security_fields();

create or replace function public.match_university_domain(p_email text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select ud.domain
  from public.university_domains ud
  where ud.active
    and (lower(split_part(p_email, '@', 2)) = ud.domain
       or lower(split_part(p_email, '@', 2)) like '%.' || ud.domain)
  order by length(ud.domain) desc
  limit 1;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_domain text;
begin
  matched_domain := public.match_university_domain(new.email);
  if matched_domain is null
     and lower(split_part(new.email, '@', 2)) like '%.edu' then
    matched_domain := lower(split_part(new.email, '@', 2));
    insert into public.university_domains(domain, institution_name, country_code, source)
    values (matched_domain, matched_domain, 'US', 'runtime .edu fallback')
    on conflict (domain) do update set active = true;
  end if;
  if matched_domain is null then
    raise exception 'University email domain is not recognized';
  end if;

  insert into public.profiles (id, email, university_domain)
  values (new.id, lower(new.email), matched_domain)
  on conflict (id) do update set email = excluded.email, university_domain = excluded.university_domain;
  return new;
end;
$$;

create trigger swapright_on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create view public.public_profiles as
select id, display_name, avatar_path, university_domain, status
from public.profiles
where status = 'active';

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  category text not null check (char_length(category) between 2 and 40),
  condition public.listing_condition not null,
  listing_type public.listing_type not null,
  asking_price_cents integer check ((listing_type = 'free' and asking_price_cents is null) or (listing_type = 'for_sale' and asking_price_cents >= 0)),
  pickup_area text not null check (char_length(pickup_area) between 2 and 120),
  status public.listing_status not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index listings_browse_idx on public.listings(status, created_at desc);
create index listings_owner_idx on public.listings(owner_id);
create trigger listings_set_updated_at
before update on public.listings
for each row execute function public.set_updated_at();

create table public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete restrict,
  claimant_id uuid not null references public.profiles(id) on delete restrict,
  status public.reservation_status not null default 'pending',
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  asking_price_snapshot_cents integer,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index one_pending_reservation_per_listing
on public.reservations(listing_id) where status = 'pending';
create index reservations_claimant_idx on public.reservations(claimant_id, status);
create index reservations_expiry_idx on public.reservations(expires_at) where status = 'pending';

create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  interested_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (listing_id, owner_id, interested_user_id),
  check (owner_id <> interested_user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.messages add column if not exists conversation_id uuid;
alter table public.messages add column if not exists read_at timestamptz;

create index messages_conversation_idx on public.messages(conversation_id, created_at);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type public.report_target not null,
  listing_id uuid references public.listings(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  reported_user_id uuid references public.profiles(id) on delete set null,
  reason text not null check (char_length(reason) between 2 and 80),
  details text check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.rate_limit_counters (
  scope text not null,
  key_hash text not null,
  window_started timestamptz not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  primary key (scope, key_hash)
);

create table public.abuse_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  ip_hash text,
  email_hash text,
  device_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and status = 'active'
      and (suspended_until is null or suspended_until <= now())
  );
$$;

create or replace function public.users_are_blocked(first_user uuid, second_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = first_user and blocked_id = second_user)
       or (blocker_id = second_user and blocked_id = first_user)
  );
$$;

create or replace function public.write_audit_log(p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), p_action, p_entity_type, p_entity_id, p_metadata);
end;
$$;

create or replace function public.claim_listing(p_listing_id uuid)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  listing_row public.listings;
  reservation_row public.reservations;
  active_count integer;
begin
  if not public.current_user_is_active() then raise exception 'Account is not eligible to claim listings'; end if;
  select * into listing_row from public.listings where id = p_listing_id for update;
  if listing_row.id is null then raise exception 'Listing not found'; end if;
  if listing_row.owner_id = (select auth.uid()) then raise exception 'Owners cannot claim their own listing'; end if;
  if listing_row.status <> 'available' then raise exception 'Listing is no longer available'; end if;
  if public.users_are_blocked(listing_row.owner_id, (select auth.uid())) then raise exception 'Users are blocked'; end if;

  select count(*) into active_count
  from public.reservations
  where claimant_id = (select auth.uid()) and status = 'pending' and expires_at > now();
  if active_count >= 3 then raise exception 'You can only have three active reservations'; end if;

  insert into public.reservations(listing_id, claimant_id, expires_at, asking_price_snapshot_cents)
  values (listing_row.id, (select auth.uid()), now() + interval '24 hours', listing_row.asking_price_cents)
  returning * into reservation_row;

  update public.listings set status = 'reserved', updated_at = now() where id = listing_row.id;
  perform public.write_audit_log('reservation.created', 'reservation', reservation_row.id, jsonb_build_object('listing_id', listing_row.id));
  return reservation_row;
end;
$$;

create or replace function public.cancel_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation_row public.reservations;
begin
  select r.* into reservation_row
  from public.reservations r
  join public.listings l on l.id = r.listing_id
  where r.id = p_reservation_id and (r.claimant_id = (select auth.uid()) or l.owner_id = (select auth.uid()))
  for update;
  if reservation_row.id is null then raise exception 'Reservation not found'; end if;
  if reservation_row.status <> 'pending' then raise exception 'Reservation is no longer active'; end if;
  update public.reservations set status = 'cancelled', cancelled_at = now() where id = reservation_row.id;
  update public.listings set status = 'available', updated_at = now() where id = reservation_row.listing_id and status = 'reserved';
  perform public.write_audit_log('reservation.cancelled', 'reservation', reservation_row.id);
end;
$$;

create or replace function public.complete_reservation(p_reservation_id uuid, p_final_price_cents integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation_row public.reservations;
begin
  select r.* into reservation_row
  from public.reservations r
  join public.listings l on l.id = r.listing_id
  where r.id = p_reservation_id and l.owner_id = (select auth.uid())
  for update;
  if reservation_row.id is null then raise exception 'Reservation not found'; end if;
  if reservation_row.status <> 'pending' or reservation_row.expires_at <= now() then raise exception 'Reservation is not completable'; end if;
  update public.reservations set status = 'completed', completed_at = now() where id = reservation_row.id;
  update public.listings set status = 'completed', updated_at = now() where id = reservation_row.listing_id;
  perform public.write_audit_log('reservation.completed', 'reservation', reservation_row.id, jsonb_build_object('final_price_cents', p_final_price_cents));
end;
$$;

create or replace function public.expire_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count integer;
begin
  with expired as (
    update public.reservations
    set status = 'expired'
    where status = 'pending' and expires_at <= now()
    returning listing_id
  )
  update public.listings l
  set status = 'available', updated_at = now()
  where l.id in (select listing_id from expired) and l.status = 'reserved'
    and not exists (select 1 from public.reservations r where r.listing_id = l.id and r.status = 'pending');
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

create or replace function public.consume_otp_rate_limit(p_ip_hash text, p_email_hash text, p_device_hash text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  now_at timestamptz := now();
  current_attempts integer;
  denied boolean := false;
  retry_after integer := 0;
begin
  for item in select * from (values
    ('otp.ip', p_ip_hash, 10, 3600),
    ('otp.email', p_email_hash, 5, 3600),
    ('otp.device', p_device_hash, 10, 3600)
  ) as limits(scope, key_hash, max_attempts, window_seconds)
  loop
    insert into public.rate_limit_counters(scope, key_hash, window_started, attempts, expires_at)
    values (item.scope, item.key_hash, now_at, 1, now_at + make_interval(secs => item.window_seconds))
    on conflict (scope, key_hash) do update set
      attempts = case when rate_limit_counters.expires_at <= now_at then 1 else rate_limit_counters.attempts + 1 end,
      window_started = case when rate_limit_counters.expires_at <= now_at then now_at else rate_limit_counters.window_started end,
      expires_at = case when rate_limit_counters.expires_at <= now_at then now_at + make_interval(secs => item.window_seconds) else rate_limit_counters.expires_at end
    returning attempts into current_attempts;
    if current_attempts > item.max_attempts then
      denied := true;
      retry_after := greatest(retry_after, extract(epoch from (now_at + make_interval(secs => item.window_seconds) - now_at))::integer);
    end if;
  end loop;

  if denied then
    insert into public.abuse_events(event_type, ip_hash, email_hash, device_hash, metadata)
    values ('otp_rate_limited', p_ip_hash, p_email_hash, p_device_hash, jsonb_build_object('retry_after_seconds', retry_after));
  end if;
  return query select not denied, retry_after;
end;
$$;

alter table public.university_domains enable row level security;
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.listing_photos enable row level security;
alter table public.reservations enable row level security;
alter table public.blocks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limit_counters enable row level security;
alter table public.abuse_events enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on public.profiles, public.listings, public.listing_photos, public.reservations, public.blocks, public.conversations, public.messages, public.reports from anon;
grant select on public.public_profiles to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.listings to authenticated;
grant select, insert, update, delete on public.listing_photos to authenticated;
grant select on public.reservations, public.conversations, public.messages to authenticated;
grant insert on public.messages, public.reports to authenticated;
grant select, insert, delete on public.blocks to authenticated;
grant execute on function public.consume_otp_rate_limit(text, text, text) to service_role;
grant execute on function public.claim_listing(uuid), public.cancel_reservation(uuid), public.complete_reservation(uuid, integer), public.expire_reservations() to authenticated;

create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy listings_select_visible on public.listings for select to authenticated using (
  (status in ('available', 'reserved') and public.current_user_is_active()) or owner_id = (select auth.uid())
);
create policy listings_insert_own on public.listings for insert to authenticated with check (owner_id = (select auth.uid()) and public.current_user_is_active());
create policy listings_update_own on public.listings for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy listings_delete_own on public.listings for delete to authenticated using (owner_id = (select auth.uid()));

create policy listing_photos_select_visible on public.listing_photos for select to authenticated using (
  owner_id = (select auth.uid()) or exists (select 1 from public.listings l where l.id = listing_id and l.status in ('available', 'reserved'))
);
create policy listing_photos_insert_own on public.listing_photos for insert to authenticated with check (owner_id = (select auth.uid()));
create policy listing_photos_update_own on public.listing_photos for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy listing_photos_delete_own on public.listing_photos for delete to authenticated using (owner_id = (select auth.uid()));

create policy reservations_select_participant on public.reservations for select to authenticated using (
  claimant_id = (select auth.uid()) or exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = (select auth.uid()))
);
create policy blocks_select_own on public.blocks for select to authenticated using (blocker_id = (select auth.uid()));
create policy blocks_insert_own on public.blocks for insert to authenticated with check (blocker_id = (select auth.uid()));
create policy blocks_delete_own on public.blocks for delete to authenticated using (blocker_id = (select auth.uid()));
create policy conversations_select_participant on public.conversations for select to authenticated using (owner_id = (select auth.uid()) or interested_user_id = (select auth.uid()));
create policy conversations_insert_interested_user on public.conversations for insert to authenticated with check (
  interested_user_id = (select auth.uid())
  and exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = owner_id and l.status in ('available', 'reserved'))
  and not public.users_are_blocked(owner_id, interested_user_id)
);
create policy messages_select_participant on public.messages for select to authenticated using (exists (select 1 from public.conversations c where c.id = conversation_id and (c.owner_id = (select auth.uid()) or c.interested_user_id = (select auth.uid()))));
create policy messages_insert_participant on public.messages for insert to authenticated with check (
  sender_id = (select auth.uid()) and exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.owner_id = (select auth.uid()) or c.interested_user_id = (select auth.uid()))
      and not public.users_are_blocked(c.owner_id, c.interested_user_id)
  )
);
create policy reports_insert_own on public.reports for insert to authenticated with check (reporter_id = (select auth.uid()));

drop policy if exists avatars_insert_own_folder on storage.objects;
drop policy if exists avatars_select_own_folder on storage.objects;
drop policy if exists avatars_update_own_folder on storage.objects;
drop policy if exists avatars_delete_own_folder on storage.objects;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;
create policy avatars_insert_own_folder on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy avatars_select_own_folder on storage.objects for select to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy avatars_update_own_folder on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text)) with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy avatars_delete_own_folder on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
