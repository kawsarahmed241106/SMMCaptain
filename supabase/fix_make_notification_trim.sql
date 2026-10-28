-- Run this in Supabase Dashboard > SQL Editor to update the live Make
-- notification trigger after setup.sql was already applied. Phone values in
-- Make are international digits only (for example, 8801570284251), no '+'.

create or replace function public.notify_make_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  make_webhook_url text;
  customer_digits text;
  customer_phone_digits text;
  author_phone_digits text;
begin
  select secret.decrypted_secret
    into make_webhook_url
    from vault.decrypted_secrets as secret
   where secret.name = 'make_order_webhook_url'
   limit 1;

  if make_webhook_url is null or make_webhook_url = '' then
    raise warning 'Order notification skipped: make_order_webhook_url is not configured in Supabase Vault.';
    return new;
  end if;

  select nullif(pg_catalog.btrim(settings ->> 'author_phone'), '')
    into author_phone_digits
    from public.site_settings
   where id = 1;
  author_phone_digits := pg_catalog.regexp_replace(
    coalesce(author_phone_digits, '+8801843161825'), '[^0-9]', '', 'g'
  );

  customer_digits := pg_catalog.regexp_replace(new.customer_phone, '[^0-9]', '', 'g');
  customer_phone_digits := case
    when pg_catalog.left(pg_catalog.btrim(new.customer_phone), 1) = '+' then customer_digits
    when customer_digits like '880%' then customer_digits
    when customer_digits like '0%' then '880' || pg_catalog.substr(customer_digits, 2)
    else '880' || customer_digits
  end;

  perform net.http_post(
    url := make_webhook_url,
    body := pg_catalog.jsonb_build_object(
      'event', 'new_order',
      'event_id', new.id,
      'order_id', new.order_number,
      'customer_phone', customer_phone_digits,
      'author_phone', author_phone_digits,
      'customer_message', E'✅ আপনার অর্ডার সফলভাবে সাবমিট হয়েছে।\n\n🆔 Order ID: ' || new.order_number || E'\n\n📦 অর্ডারের আপডেট দেখতে ভিজিট করুন:\nhttps://smmcaptain.xyz/track\n\nকোনো কিছু জানার থাকলে বা অন্য কোনো বিষয়ে সাহায্য লাগলে জানাবেন। 😊\n\nধন্যবাদ ❤️',
      'author_message', E'Congrats, New Order Submitted\nOrder ID: ' || new.order_number || E'\nhttps://smmcaptain.xyz/admin/orders.html',
      'track_url', 'https://smmcaptain.xyz/track'
    ),
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 5000
  );

  return new;
exception when others then
  -- Keep order creation working if an external notification service is down.
  raise warning 'Order % saved, but its Make notification could not be queued: %', new.order_number, sqlerrm;
  return new;
end;
$$;

-- All three checks should return true before testing a fresh order.
select
  pg_get_functiondef('public.notify_make_new_order()'::regprocedure) like '%customer_phone_digits%' as phone_is_digits_only,
  pg_get_functiondef('public.notify_make_new_order()'::regprocedure) like '%customer_message%' as customer_message_installed,
  pg_get_functiondef('public.notify_make_new_order()'::regprocedure) like '%author_message%' as author_message_installed;
