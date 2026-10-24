-- Authenticated students create a conversation after reserving an item.
-- Row-level security still restricts which conversation rows they may insert.
grant insert on public.conversations to authenticated;
