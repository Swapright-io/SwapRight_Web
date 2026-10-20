create or replace function public.consume_password_auth_rate_limit(
  p_ip_hash text,
  p_email_hash text,
  p_device_hash text
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  now_at timestamptz := now();
  current_attempts integer;
  counter_expires_at timestamptz;
  denied boolean := false;
  retry_after integer := 0;
begin
  for item in select * from (values
    ('password.ip', p_ip_hash, 30, 600),
    ('password.email', p_email_hash, 20, 600),
    ('password.device', p_device_hash, 20, 600)
  ) as limits(scope, key_hash, max_attempts, window_seconds)
  loop
    insert into public.rate_limit_counters(scope, key_hash, window_started, attempts, expires_at)
    values (item.scope, item.key_hash, now_at, 1, now_at + make_interval(secs => item.window_seconds))
    on conflict (scope, key_hash) do update set
      attempts = case when rate_limit_counters.expires_at <= now_at then 1 else rate_limit_counters.attempts + 1 end,
      window_started = case when rate_limit_counters.expires_at <= now_at then now_at else rate_limit_counters.window_started end,
      expires_at = case when rate_limit_counters.expires_at <= now_at then now_at + make_interval(secs => item.window_seconds) else rate_limit_counters.expires_at end
    returning attempts, expires_at into current_attempts, counter_expires_at;

    if current_attempts > item.max_attempts then
      denied := true;
      retry_after := greatest(
        retry_after,
        ceil(extract(epoch from (counter_expires_at - now_at)))::integer
      );
    end if;
  end loop;

  if denied then
    insert into public.abuse_events(event_type, ip_hash, email_hash, device_hash, metadata)
    values ('password_auth_rate_limited', p_ip_hash, p_email_hash, p_device_hash, jsonb_build_object('retry_after_seconds', retry_after));
  end if;

  return query select not denied, retry_after;
end;
$$;

revoke all on function public.consume_password_auth_rate_limit(text, text, text) from public, anon, authenticated;
grant execute on function public.consume_password_auth_rate_limit(text, text, text) to service_role;
