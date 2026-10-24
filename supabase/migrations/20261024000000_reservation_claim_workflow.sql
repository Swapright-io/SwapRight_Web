-- Keep reservation history useful after a listing is removed, and require both
-- sides to confirm a completed handoff.
alter table public.reservations
  alter column listing_id drop not null,
  drop constraint if exists reservations_listing_id_fkey,
  add constraint reservations_listing_id_fkey
    foreign key (listing_id) references public.listings(id) on delete set null,
  drop constraint if exists reservations_claimant_id_fkey,
  add constraint reservations_claimant_id_fkey
    foreign key (claimant_id) references public.profiles(id) on delete cascade;

alter table public.reservations
  add column if not exists donor_id uuid references public.profiles(id) on delete set null,
  add column if not exists claim_requested_at timestamptz,
  add column if not exists donor_reviewed_at timestamptz,
  add column if not exists claim_confirmation_status text not null default 'not_requested'
    check (claim_confirmation_status in ('not_requested', 'awaiting_donor', 'confirmed', 'declined')),
  add column if not exists resolution_reason text,
  add column if not exists pickup_area_snapshot text,
  add column if not exists listing_title_snapshot text,
  add column if not exists listing_description_snapshot text,
  add column if not exists listing_category_snapshot text,
  add column if not exists listing_condition_snapshot public.listing_condition,
  add column if not exists listing_type_snapshot public.listing_type,
  add column if not exists photo_paths_snapshot text[] not null default '{}';

create index if not exists reservations_donor_idx on public.reservations(donor_id, status);

update public.reservations r
set donor_id = l.owner_id,
    pickup_area_snapshot = l.pickup_area,
    listing_title_snapshot = l.title,
    listing_description_snapshot = l.description,
    listing_category_snapshot = l.category,
    listing_condition_snapshot = l.condition,
    listing_type_snapshot = l.listing_type,
    photo_paths_snapshot = coalesce(p.paths, '{}'::text[])
from public.listings l
left join lateral (
  select array_agg(lp.storage_path order by lp.sort_order) as paths
  from public.listing_photos lp
  where lp.listing_id = l.id
) p on true
where r.listing_id = l.id;

create or replace function public.snapshot_reservation_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  listing_row public.listings;
begin
  select * into listing_row from public.listings where id = new.listing_id;
  if listing_row.id is null then raise exception 'Listing not found'; end if;
  new.donor_id := listing_row.owner_id;
  new.asking_price_snapshot_cents := listing_row.asking_price_cents;
  new.pickup_area_snapshot := listing_row.pickup_area;
  new.listing_title_snapshot := listing_row.title;
  new.listing_description_snapshot := listing_row.description;
  new.listing_category_snapshot := listing_row.category;
  new.listing_condition_snapshot := listing_row.condition;
  new.listing_type_snapshot := listing_row.listing_type;
  select coalesce(array_agg(lp.storage_path order by lp.sort_order), '{}'::text[])
    into new.photo_paths_snapshot
  from public.listing_photos lp
  where lp.listing_id = listing_row.id;
  return new;
end;
$$;

drop trigger if exists reservations_snapshot_item on public.reservations;
create trigger reservations_snapshot_item
before insert on public.reservations
for each row execute function public.snapshot_reservation_item();

create or replace function public.cancel_reservations_for_deleted_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.reservations
  set status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, now()),
      resolution_reason = 'listing_deleted',
      claim_confirmation_status = case
        when claim_confirmation_status = 'awaiting_donor' then 'declined'
        else claim_confirmation_status
      end
  where listing_id = old.id and status = 'pending';
  return old;
end;
$$;

drop trigger if exists listings_cancel_reservations_before_delete on public.listings;
create trigger listings_cancel_reservations_before_delete
before delete on public.listings
for each row execute function public.cancel_reservations_for_deleted_listing();

drop policy if exists reservations_select_participant on public.reservations;
create policy reservations_select_participant on public.reservations
for select to authenticated using (
  claimant_id = (select auth.uid()) or donor_id = (select auth.uid())
);

alter table public.notifications
  drop constraint if exists notifications_notification_type_check;
alter table public.notifications
  add constraint notifications_notification_type_check
    check (notification_type in ('reservation', 'listing_report', 'message', 'claim_confirmation'));

create or replace function public.request_claim_confirmation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation_row public.reservations;
  claimant public.profiles;
begin
  select * into reservation_row from public.reservations
  where id = p_reservation_id for update;
  if reservation_row.id is null or reservation_row.claimant_id <> (select auth.uid()) then
    raise exception 'Reservation not found';
  end if;
  if not public.current_user_is_active() then raise exception 'Account is not active'; end if;
  if reservation_row.status <> 'pending' or reservation_row.expires_at <= now() then
    raise exception 'This reservation is no longer active';
  end if;
  if reservation_row.claim_confirmation_status <> 'not_requested' then
    raise exception 'Claim confirmation has already been requested';
  end if;
  if reservation_row.donor_id is null then raise exception 'The donor is no longer available'; end if;

  update public.reservations
  set claim_requested_at = now(), claim_confirmation_status = 'awaiting_donor'
  where id = reservation_row.id;

  select * into claimant from public.profiles where id = reservation_row.claimant_id;
  insert into public.notifications(user_id, notification_type, title, body, listing_id, actor_id, metadata)
  values (
    reservation_row.donor_id,
    'claim_confirmation',
    'Confirm item handoff',
    coalesce(nullif(claimant.display_name, ''), 'A student') || ' says they received ' || coalesce(reservation_row.listing_title_snapshot, 'your item') || '. Please confirm the handoff.',
    reservation_row.listing_id,
    reservation_row.claimant_id,
    jsonb_build_object('reservation_id', reservation_row.id)
  );
end;
$$;

create or replace function public.resolve_claim_confirmation(p_reservation_id uuid, p_confirmed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation_row public.reservations;
  next_status public.reservation_status;
  next_confirmation_status text;
  next_reason text;
begin
  select * into reservation_row from public.reservations
  where id = p_reservation_id for update;
  if reservation_row.id is null or reservation_row.donor_id <> (select auth.uid()) then
    raise exception 'Reservation not found';
  end if;
  if reservation_row.status <> 'pending'
     or reservation_row.expires_at <= now()
     or reservation_row.claim_confirmation_status <> 'awaiting_donor' then
    raise exception 'There is no pending claim confirmation';
  end if;

  next_status := case when p_confirmed then 'completed'::public.reservation_status else 'cancelled'::public.reservation_status end;
  next_confirmation_status := case when p_confirmed then 'confirmed' else 'declined' end;
  next_reason := case when p_confirmed then 'donor_confirmed' else 'donor_declined' end;

  update public.reservations
  set status = next_status,
      completed_at = case when p_confirmed then now() else completed_at end,
      cancelled_at = case when p_confirmed then cancelled_at else now() end,
      donor_reviewed_at = now(),
      claim_confirmation_status = next_confirmation_status,
      resolution_reason = next_reason
  where id = reservation_row.id;

  if reservation_row.listing_id is not null then
    update public.listings
    set status = case when p_confirmed then 'completed'::public.listing_status else 'available'::public.listing_status end,
        updated_at = now()
    where id = reservation_row.listing_id and status = 'reserved';
  end if;

  insert into public.notifications(user_id, notification_type, title, body, listing_id, actor_id, metadata)
  values (
    reservation_row.claimant_id,
    'claim_confirmation',
    case when p_confirmed then 'Handoff confirmed' else 'Item available again' end,
    case when p_confirmed
      then 'The donor confirmed that you received ' || coalesce(reservation_row.listing_title_snapshot, 'the item') || '.'
      else 'The donor could not confirm the handoff. ' || coalesce(reservation_row.listing_title_snapshot, 'The item') || ' is available in Browse again.'
    end,
    reservation_row.listing_id,
    reservation_row.donor_id,
    jsonb_build_object('reservation_id', reservation_row.id, 'confirmed', p_confirmed)
  );
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
  reason text;
begin
  select r.* into reservation_row
  from public.reservations r
  where r.id = p_reservation_id
    and (r.claimant_id = (select auth.uid()) or r.donor_id = (select auth.uid()))
  for update;
  if reservation_row.id is null then raise exception 'Reservation not found'; end if;
  if reservation_row.status <> 'pending' then raise exception 'Reservation is no longer active'; end if;
  reason := case when reservation_row.claimant_id = (select auth.uid()) then 'claimant_cancelled' else 'donor_cancelled' end;
  update public.reservations
  set status = 'cancelled', cancelled_at = now(), resolution_reason = reason,
      claim_confirmation_status = case when claim_confirmation_status = 'awaiting_donor' then 'declined' else claim_confirmation_status end,
      donor_reviewed_at = case when claim_confirmation_status = 'awaiting_donor' then now() else donor_reviewed_at end
  where id = reservation_row.id;
  if reservation_row.listing_id is not null then
    update public.listings set status = 'available', updated_at = now()
    where id = reservation_row.listing_id and status = 'reserved';
  end if;
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
    set status = 'expired', resolution_reason = 'reservation_timeout',
        claim_confirmation_status = case when claim_confirmation_status = 'awaiting_donor' then 'declined' else claim_confirmation_status end,
        donor_reviewed_at = case when claim_confirmation_status = 'awaiting_donor' then now() else donor_reviewed_at end
    where status = 'pending' and expires_at <= now()
    returning listing_id
  ), released as (
    update public.listings l
    set status = 'available', updated_at = now()
    where l.id in (select listing_id from expired where listing_id is not null)
      and l.status = 'reserved'
      and not exists (select 1 from public.reservations r where r.listing_id = l.id and r.status = 'pending')
    returning l.id
  )
  select count(*)::integer into expired_count from expired;
  return expired_count;
end;
$$;

-- These actions must go through authenticated RPCs. Expiry itself runs as the
-- database owner from pg_cron, never from a browser client.
revoke all on function public.expire_reservations() from public, anon, authenticated;
grant execute on function public.expire_reservations() to service_role;
revoke all on function public.request_claim_confirmation(uuid) from public, anon, authenticated;
grant execute on function public.request_claim_confirmation(uuid) to authenticated;
revoke all on function public.resolve_claim_confirmation(uuid, boolean) from public, anon, authenticated;
grant execute on function public.resolve_claim_confirmation(uuid, boolean) to authenticated;
revoke all on function public.cancel_reservation(uuid) from public, anon, authenticated;
grant execute on function public.cancel_reservation(uuid) to authenticated;
revoke all on function public.complete_reservation(uuid, integer) from public, anon, authenticated;

create extension if not exists pg_cron;
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'swapright-expire-reservations';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('swapright-expire-reservations', '* * * * *', 'select public.expire_reservations();');
end;
$$;
