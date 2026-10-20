drop policy if exists conversations_insert_interested_user on public.conversations;

create policy conversations_insert_interested_user
on public.conversations for insert to authenticated
with check (
  interested_user_id = (select auth.uid())
  and owner_id <> (select auth.uid())
  and exists (
    select 1 from public.listings l
    where l.id = conversations.listing_id
      and l.owner_id = conversations.owner_id
      and l.status = 'reserved'
  )
  and exists (
    select 1 from public.reservations r
    where r.listing_id = conversations.listing_id
      and r.claimant_id = (select auth.uid())
      and r.status = 'pending'
      and r.expires_at > now()
  )
  and not public.users_are_blocked(owner_id, interested_user_id)
);
