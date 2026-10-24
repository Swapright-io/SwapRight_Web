-- Let a conversation participant mark received messages as read.
-- Column-level grants prevent changing message contents or sender identity.
grant update (read_at) on public.messages to authenticated;

drop policy if exists messages_mark_received_read on public.messages;
create policy messages_mark_received_read
on public.messages for update to authenticated
using (
  sender_id <> (select auth.uid())
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and (c.owner_id = (select auth.uid()) or c.interested_user_id = (select auth.uid()))
  )
)
with check (
  sender_id <> (select auth.uid())
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and (c.owner_id = (select auth.uid()) or c.interested_user_id = (select auth.uid()))
  )
);
