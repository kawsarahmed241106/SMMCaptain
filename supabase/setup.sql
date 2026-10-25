-- Run this file in Supabase Dashboard > SQL Editor.
-- Create the admin user under Authentication > Users and disable public sign-ups.
-- Run the role assignment at the bottom after that user exists.

create table if not exists public.site_settings (
  id smallint primary key check (id = 1),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

grant select on public.site_settings to anon;
grant select, insert, update on public.site_settings to authenticated;

drop policy if exists "Public can read site settings" on public.site_settings;
create policy "Public can read site settings"
  on public.site_settings for select to anon
  using (true);

drop policy if exists "Site admins can read settings" on public.site_settings;
create policy "Site admins can read settings"
  on public.site_settings for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin');

drop policy if exists "Site admins can insert settings" on public.site_settings;
create policy "Site admins can insert settings"
  on public.site_settings for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin');

drop policy if exists "Site admins can update settings" on public.site_settings;
create policy "Site admins can update settings"
  on public.site_settings for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin');

-- Grant the admin role to the SMMCaptain admin account.
-- Change this email if the account used to sign in at /admin/ is different.
-- If this file was run before the user was created, run this block again afterward.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || '{"role":"site_admin"}'::jsonb
where lower(email) = lower('smmcaptain@gmail.com');

-- Verify that the configured admin account has the required app-metadata role.
select email, raw_app_meta_data ->> 'role' as app_role
from auth.users
where lower(email) = lower('smmcaptain@gmail.com');

-- The legacy create_campaign_order routine below is revoked after creation.
-- The payment-required migration creates orders only after a verified payment.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  created_at timestamptz not null default now(),
  customer_email text,
  customer_phone text not null,
  ad_whatsapp text not null default '',
  details jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  payment_token uuid not null default gen_random_uuid(),
  payment_status text not null default 'unpaid',
  payment_invoice_id text,
  payment_url text,
  payment_amount numeric(12, 2),
  payment_method text,
  payment_transaction_id text,
  payment_attempted_at timestamptz,
  paid_at timestamptz
);

-- Keep this base setup safe to rerun after payment_setup.sql has been applied.
alter table public.orders
  add column if not exists payment_token uuid not null default gen_random_uuid(),
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_invoice_id text,
  add column if not exists payment_url text,
  add column if not exists payment_amount numeric(12, 2),
  add column if not exists payment_method text,
  add column if not exists payment_transaction_id text,
  add column if not exists payment_attempted_at timestamptz,
  add column if not exists paid_at timestamptz;

-- Pending is the initial public order status. Convert legacy `new` rows before
-- replacing the old constraint so this migration is safe to run more than once.
alter table public.orders alter column status set default 'pending';
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders drop constraint if exists orders_status_workflow_check;
update public.orders set status = 'pending' where status = 'new';
alter table public.orders add constraint orders_status_workflow_check
  check (status in ('pending', 'processing', 'completed', 'cancelled'));

alter table public.orders drop column if exists email_status;
alter table public.orders alter column customer_email drop not null;

create extension if not exists pg_net;

create index if not exists orders_created_at_idx on public.orders (created_at desc);
alter table public.orders enable row level security;
revoke all on public.orders from public, anon, authenticated;
grant select on public.orders to authenticated;
grant update (status) on public.orders to authenticated;
grant delete on public.orders to authenticated;

drop policy if exists "Site admins can read orders" on public.orders;
create policy "Site admins can read orders"
  on public.orders for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin');

drop policy if exists "Site admins can update order status" on public.orders;
create policy "Site admins can update order status"
  on public.orders for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin');

drop policy if exists "Site admins can delete orders" on public.orders;
create policy "Site admins can delete orders"
  on public.orders for delete to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin');

create table if not exists public.order_daily_counters (
  order_date date primary key,
  last_number integer not null
);
alter table public.order_daily_counters enable row level security;
revoke all on public.order_daily_counters from anon, authenticated;

create or replace function public.create_campaign_order(
  p_customer_phone text,
  p_ad_whatsapp text,
  p_details jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  local_order_date date := (now() at time zone 'Asia/Dhaka')::date;
  sequence_number integer;
  generated_order_number text;
  created_order public.orders%rowtype;
  daily_usd numeric(10, 2);
  campaign_days integer;
  current_rate numeric(10, 2);
  trusted_details jsonb;
begin
  if p_customer_phone is null or length(trim(p_customer_phone)) < 6 then
    raise exception 'A valid customer WhatsApp number is required.' using errcode = '22023';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Order details are required.' using errcode = '22023';
  end if;
  if octet_length(p_details::text) > 65536 then
    raise exception 'Order details are too large.' using errcode = '22023';
  end if;
  if coalesce(p_details->>'dailyBudgetUsd', '') !~ '^([0-9]+)(\.[0-9]{1,2})?$'
     or coalesce(p_details->>'days', '') !~ '^[0-9]{1,3}$' then
    raise exception 'A valid campaign budget and duration are required.' using errcode = '22023';
  end if;

  daily_usd := (p_details->>'dailyBudgetUsd')::numeric;
  campaign_days := (p_details->>'days')::integer;
  if daily_usd < 2 or daily_usd > 1000 or campaign_days < 1 or campaign_days > 365
     or daily_usd * campaign_days < 10 then
    raise exception 'The campaign budget or duration is outside the allowed range.' using errcode = '22023';
  end if;

  select case
    when coalesce(settings->>'dollarRate', '') ~ '^([0-9]+)(\.[0-9]{1,2})?$'
      then (settings->>'dollarRate')::numeric
    else 150
  end
    into current_rate
    from public.site_settings
   where id = 1;
  current_rate := greatest(coalesce(current_rate, 150), 1);

  trusted_details := p_details || jsonb_build_object(
    'dailyBudgetUsd', daily_usd,
    'days', campaign_days,
    'totalBudgetUsd', daily_usd * campaign_days,
    'dollarRate', current_rate,
    'totalBudgetBdt', round(daily_usd * campaign_days * current_rate, 2)
  );

  insert into public.order_daily_counters (order_date, last_number)
  values (local_order_date, 1041)
  on conflict (order_date) do update
    set last_number = greatest(public.order_daily_counters.last_number + 1, 1041)
  returning last_number into sequence_number;

  generated_order_number := 'SC-' || to_char(local_order_date, 'YYYYMMDD') || '-' || sequence_number::text;

  insert into public.orders (order_number, customer_phone, ad_whatsapp, details)
  values (generated_order_number, trim(p_customer_phone), coalesce(trim(p_ad_whatsapp), ''), trusted_details)
  returning * into created_order;

  return jsonb_build_object(
    'order_id', created_order.id,
    'order_number', created_order.order_number,
    'checkout_token', created_order.payment_token,
    'created_at', created_order.created_at
  );
end;
$$;

revoke all on function public.create_campaign_order(text, text, jsonb) from public;
revoke all on function public.create_campaign_order(text, text, jsonb) from anon, authenticated;

-- Send a minimal order event to Make after the order transaction commits.
-- Store the Make custom webhook URL in Supabase Vault as make_order_webhook_url.
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

drop trigger if exists orders_notify_make on public.orders;
create trigger orders_notify_make
  after insert on public.orders
  for each row execute function public.notify_make_new_order();

-- This public RPC reveals only a matching order's number, status, and time.
-- It never returns customer contact information or campaign details.
drop function if exists public.track_campaign_order(text);
create function public.track_campaign_order(p_order_number text)
returns table (order_number text, created_at timestamptz, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.order_number, o.created_at, o.status
    from public.orders as o
   where p_order_number ~ '^SC-[0-9]{8}-([0-9]{5}|[1-9][0-9]{3,})$'
     and o.order_number = pg_catalog.upper(pg_catalog.btrim(p_order_number))
     and o.payment_status = 'paid'
   limit 1;
$$;

revoke all on function public.track_campaign_order(text) from public;
grant execute on function public.track_campaign_order(text) to anon, authenticated;
