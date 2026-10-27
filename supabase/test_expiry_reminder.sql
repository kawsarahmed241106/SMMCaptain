-- Temporary admin-only test helper for the Make expiry_reminder route.
-- Run this once in Supabase SQL Editor while the temporary admin button is needed.
-- Remove it after testing with:
-- drop function if exists public.send_test_campaign_order_expiry_reminder(uuid);

create or replace function public.send_test_campaign_order_expiry_reminder(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row record;
  webhook_url text;
  customer_digits text;
  customer_phone_digits text;
  reminder_message text;
  dispatch_id text;
  request_id bigint;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'site_admin' then
    raise exception 'Admin access is required to send a test reminder.' using errcode = '42501';
  end if;

  select o.id, o.order_number, o.customer_phone, o.details
    into order_row
    from public.orders as o
   where o.id = p_order_id
     and o.payment_status = 'paid';
  if not found then
    raise exception 'Paid order not found.' using errcode = 'P0002';
  end if;

  select secret.decrypted_secret
    into webhook_url
    from vault.decrypted_secrets as secret
   where secret.name = 'make_order_webhook_url'
   limit 1;
  if webhook_url is null or webhook_url = '' then
    raise exception 'The Make order webhook is not configured in Supabase Vault.' using errcode = '55000';
  end if;

  customer_digits := pg_catalog.regexp_replace(order_row.customer_phone, '[^0-9]', '', 'g');
  customer_phone_digits := case
    when pg_catalog.left(pg_catalog.btrim(order_row.customer_phone), 1) = '+' then customer_digits
    when customer_digits like '880%' then customer_digits
    when customer_digits like '0%' then '880' || pg_catalog.substr(customer_digits, 2)
    else '880' || customer_digits
  end;
  reminder_message := case when order_row.details->>'days' = '1'
    then 'Your ad/order will expire in 6 hours.'
    else 'Your ad/order will expire in 24 hours.'
  end;
  dispatch_id := 'test-expiry-' || pg_catalog.gen_random_uuid()::text;

  request_id := net.http_post(
    url := webhook_url,
    body := pg_catalog.jsonb_build_object(
      'event', 'expiry_reminder',
      'event_id', dispatch_id,
      'test_mode', true,
      'order_id', order_row.order_number,
      'customer_phone', customer_phone_digits,
      'message', reminder_message,
      'track_url', 'https://smmcaptain.xyz/track/'
    ),
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  );

  return pg_catalog.jsonb_build_object(
    'queued', true,
    'request_id', request_id,
    'event_id', dispatch_id,
    'message', reminder_message
  );
end;
$$;

revoke all on function public.send_test_campaign_order_expiry_reminder(uuid) from public, anon;
grant execute on function public.send_test_campaign_order_expiry_reminder(uuid) to authenticated;
