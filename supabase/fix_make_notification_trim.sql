-- Run this in Supabase Dashboard > SQL Editor to repair the live Make
-- notification trigger after the original setup.sql was applied.
-- PostgreSQL's TRIM is syntax; the callable catalog function is btrim(text).

create or replace function public.notify_make_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  make_webhook_url text;
  customer_digits text;
  customer_phone_e164 text;
  author_phone text;
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
    into author_phone
    from public.site_settings
   where id = 1;
  author_phone := coalesce(author_phone, '+8801843161825');

  customer_digits := pg_catalog.regexp_replace(new.customer_phone, '[^0-9]', '', 'g');
  customer_phone_e164 := case
    when pg_catalog.left(pg_catalog.btrim(new.customer_phone), 1) = '+' then '+' || customer_digits
    when customer_digits like '880%' then '+' || customer_digits
    when customer_digits like '0%' then '+880' || pg_catalog.substr(customer_digits, 2)
    else '+880' || customer_digits
  end;

  perform net.http_post(
    url := make_webhook_url,
    body := pg_catalog.jsonb_build_object(
      'event', 'new_order',
      'event_id', new.id,
      'order_id', new.order_number,
      'customer_phone', customer_phone_e164,
      'author_phone', author_phone,
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

-- Returns true when the corrected phone trim call is installed.
select pg_get_functiondef('public.notify_make_new_order()'::regprocedure)
  like '%pg_catalog.btrim(new.customer_phone)%' as fixed;
