create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reservation_alerts boolean not null default true,
  message_alerts boolean not null default true,
  safety_alerts boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null check (notification_type in ('reservation', 'listing_report', 'message')),
  title text not null,
  body text not null,
  listing_id uuid references public.listings(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx on public.notifications(user_id, created_at desc);

alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;

revoke all on public.notification_preferences, public.notifications from anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select, update on public.notifications to authenticated;

create policy notification_preferences_select_own on public.notification_preferences
for select to authenticated using (user_id = (select auth.uid()));
create policy notification_preferences_insert_own on public.notification_preferences
for insert to authenticated with check (user_id = (select auth.uid()));
create policy notification_preferences_update_own on public.notification_preferences
for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_select_own on public.notifications
for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications
for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function public.notify_listing_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  listing_row public.listings;
  claimant public.profiles;
begin
  select * into listing_row from public.listings where id = new.listing_id;
  select * into claimant from public.profiles where id = new.claimant_id;
  if listing_row.id is not null and listing_row.owner_id <> new.claimant_id
    and coalesce((select reservation_alerts from public.notification_preferences where user_id = listing_row.owner_id), true) then
    insert into public.notifications(user_id, notification_type, title, body, listing_id, actor_id, metadata)
    values (
      listing_row.owner_id,
      'reservation',
      'Your item was reserved',
      coalesce(nullif(claimant.display_name, ''), 'A student') || ' reserved ' || listing_row.title || '.',
      listing_row.id,
      claimant.id,
      jsonb_build_object('reservee_name', coalesce(nullif(claimant.display_name, ''), 'Student'), 'reservee_avatar_path', claimant.avatar_path)
    );
  end if;
  return new;
end;
$$;

create trigger reservations_notify_donor
after insert on public.reservations
for each row execute function public.notify_listing_reservation();

create or replace function public.notify_listing_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  listing_owner uuid;
  listing_title text;
begin
  if new.listing_id is not null and new.reporter_id <> new.reported_user_id then
    select owner_id, title into listing_owner, listing_title from public.listings where id = new.listing_id;
    if listing_owner is not null and coalesce((select safety_alerts from public.notification_preferences where user_id = listing_owner), true) then
      insert into public.notifications(user_id, notification_type, title, body, listing_id, actor_id, metadata)
      values (
        listing_owner,
        'listing_report',
        'A listing was reported',
        'A student reported “' || listing_title || '”. Please review the listing and confirm the item, photos, and description match and follow campus guidelines.',
        new.listing_id,
        null,
        jsonb_build_object('warning', 'Please check that the item name, photos, description, and campus rules all match.')
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger reports_notify_listing_owner
after insert on public.reports
for each row execute function public.notify_listing_report();

create or replace function public.notify_message_recipient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation_row public.conversations;
  sender public.profiles;
  recipient_id uuid;
  listing_title text;
begin
  select * into conversation_row from public.conversations where id = new.conversation_id;
  if conversation_row.id is null then return new; end if;
  recipient_id := case when new.sender_id = conversation_row.owner_id then conversation_row.interested_user_id else conversation_row.owner_id end;
  select * into sender from public.profiles where id = new.sender_id;
  select title into listing_title from public.listings where id = conversation_row.listing_id;
  if coalesce((select message_alerts from public.notification_preferences where user_id = recipient_id), true) then
    insert into public.notifications(user_id, notification_type, title, body, listing_id, actor_id, metadata)
    values (
      recipient_id,
      'message',
      'New message',
      coalesce(nullif(sender.display_name, ''), 'A student') || ' sent you a message about ' || coalesce(listing_title, 'an item') || '.',
      conversation_row.listing_id,
      sender.id,
      jsonb_build_object('sender_name', coalesce(nullif(sender.display_name, ''), 'Student'), 'sender_avatar_path', sender.avatar_path)
    );
  end if;
  return new;
end;
$$;

create trigger messages_notify_recipient
after insert on public.messages
for each row execute function public.notify_message_recipient();

drop policy if exists avatars_select_reservation_counterparty on storage.objects;
create policy avatars_select_reservation_counterparty on storage.objects
for select to authenticated using (
  bucket_id = 'avatars'
  and exists (
    select 1
    from public.reservations r
    join public.listings l on l.id = r.listing_id
    where r.status = 'pending'
      and r.expires_at > now()
      and (
        (l.owner_id = (select auth.uid()) and (storage.foldername(name))[1] = r.claimant_id::text)
        or (r.claimant_id = (select auth.uid()) and (storage.foldername(name))[1] = l.owner_id::text)
      )
  )
);
