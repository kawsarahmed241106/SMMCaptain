-- Run this migration in Supabase SQL Editor after setup.sql and payment_setup.sql.
-- Unpaid form submissions are stored only as private checkout intents. A row in
-- public.orders (and its order ID/WhatsApp notification) is created only after
-- the server verifies a completed UddoktaPay payment.

create table if not exists public.order_payment_intents (
  id uuid primary key default gen_random_uuid(),
  checkout_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  customer_phone text not null,
  ad_whatsapp text not null default '',
  details jsonb not null default '{}'::jsonb,
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'creating', 'pending', 'paid', 'failed', 'cancelled')),
  payment_invoice_id text,
  payment_url text,
  payment_amount numeric(12, 2) not null,
  payment_method text,
  payment_transaction_id text,
  payment_attempted_at timestamptz,
  paid_at timestamptz,
  created_order_id uuid
);

alter table public.order_payment_intents enable row level security;
revoke all on public.order_payment_intents from public, anon, authenticated;
grant all on public.order_payment_intents to service_role;
create index if not exists order_payment_intents_expiry_idx
  on public.order_payment_intents (expires_at);
create unique index if not exists order_payment_intents_invoice_uidx
  on public.order_payment_intents (payment_invoice_id)
  where payment_invoice_id is not null;

-- Disable the old RPC that inserted a public order before payment.
drop function if exists public.create_campaign_order(text, text, jsonb);

create or replace function public.create_campaign_checkout_intent(
  p_customer_phone text,
  p_ad_whatsapp text,
  p_details jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  checkout_intent public.order_payment_intents%rowtype;
  daily_usd numeric(10, 2);
  campaign_days integer;
  current_rate numeric(10, 2);
  trusted_details jsonb;
  total_amount numeric(12, 2);
begin
  if p_customer_phone is null or length(trim(p_customer_phone)) < 6 then
    raise exception 'A valid customer WhatsApp number is required.' using errcode = '22023';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Order details are required.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_details->>'location', '')), '') is null then
    raise exception 'A campaign location is required.' using errcode = '22023';
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
  total_amount := round(daily_usd * campaign_days * current_rate, 2);

  trusted_details := p_details || jsonb_build_object(
    'dailyBudgetUsd', daily_usd,
    'days', campaign_days,
    'totalBudgetUsd', daily_usd * campaign_days,
    'dollarRate', current_rate,
    'totalBudgetBdt', total_amount
  );

  insert into public.order_payment_intents (
    customer_phone, ad_whatsapp, details, payment_amount
  ) values (
    trim(p_customer_phone), coalesce(trim(p_ad_whatsapp), ''), trusted_details, total_amount
  ) returning * into checkout_intent;

  return jsonb_build_object(
    'checkout_id', checkout_intent.id,
    'checkout_token', checkout_intent.checkout_token,
    'expires_at', checkout_intent.expires_at
  );
end;
$$;

revoke all on function public.create_campaign_checkout_intent(text, text, jsonb) from public;
grant execute on function public.create_campaign_checkout_intent(text, text, jsonb) to anon, authenticated;

-- Called only by the payment-verification Edge Function using the service role.
-- The row lock and saved order reference make finalization safe to retry.
create or replace function public.finalize_paid_campaign_order(
  p_checkout_token uuid,
  p_invoice_id text,
  p_payment_method text,
  p_transaction_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  checkout_intent public.order_payment_intents%rowtype;
  existing_order public.orders%rowtype;
  created_order public.orders%rowtype;
  local_order_date date := (now() at time zone 'Asia/Dhaka')::date;
  sequence_number integer;
  generated_order_number text;
begin
  if p_checkout_token is null or nullif(trim(p_invoice_id), '') is null then
    raise exception 'A verified checkout token and invoice ID are required.' using errcode = '22023';
  end if;

  select * into checkout_intent
    from public.order_payment_intents
   where checkout_token = p_checkout_token
   for update;
  if not found then
    raise exception 'Payment session not found.' using errcode = 'P0002';
  end if;

  if checkout_intent.created_order_id is not null then
    if checkout_intent.payment_invoice_id is distinct from p_invoice_id then
      raise exception 'This payment session was finalized with a different invoice.' using errcode = '23505';
    end if;
    select * into existing_order from public.orders where id = checkout_intent.created_order_id;
    if not found then
      raise exception 'The finalized order could not be found.' using errcode = 'P0002';
    end if;
    return jsonb_build_object(
      'order_id', existing_order.id,
      'order_number', existing_order.order_number,
      'created_at', existing_order.created_at,
      'payment_status', 'paid'
    );
  end if;

  insert into public.order_daily_counters (order_date, last_number)
  values (local_order_date, 1041)
  on conflict (order_date) do update
    set last_number = greatest(public.order_daily_counters.last_number + 1, 1041)
  returning last_number into sequence_number;

  generated_order_number := 'SC-' || to_char(local_order_date, 'YYYYMMDD') || '-' || sequence_number::text;

  insert into public.orders (
    order_number, customer_phone, ad_whatsapp, details, status, payment_token,
    payment_status, payment_invoice_id, payment_amount, payment_method,
    payment_transaction_id, payment_attempted_at, paid_at
  ) values (
    generated_order_number, checkout_intent.customer_phone, checkout_intent.ad_whatsapp,
    checkout_intent.details, 'pending', checkout_intent.checkout_token,
    'paid', p_invoice_id, checkout_intent.payment_amount,
    nullif(p_payment_method, ''), nullif(p_transaction_id, ''),
    checkout_intent.payment_attempted_at, now()
  ) returning * into created_order;

  update public.order_payment_intents
     set payment_status = 'paid',
         payment_invoice_id = p_invoice_id,
         payment_method = nullif(p_payment_method, ''),
         payment_transaction_id = nullif(p_transaction_id, ''),
         paid_at = now(),
         created_order_id = created_order.id
   where id = checkout_intent.id;

  return jsonb_build_object(
    'order_id', created_order.id,
    'order_number', created_order.order_number,
    'created_at', created_order.created_at,
    'payment_status', 'paid'
  );
end;
$$;

revoke all on function public.finalize_paid_campaign_order(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finalize_paid_campaign_order(uuid, text, text, text) to service_role;

-- Previously created but unpaid orders are not valid submitted orders. Keep
-- them private from admin and tracking views while preserving their records.
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

-- Public tracker lookup by order ID or customer phone; return only minimal
-- order information and sort phone matches newest first.
drop function if exists public.track_campaign_orders(text);
create function public.track_campaign_orders(p_search text)
returns table (order_number text, created_at timestamptz, status text, cancellation_reason text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  search_value text := pg_catalog.btrim(coalesce(p_search, ''));
  phone_digits text;
  normalized_phone text;
begin
  if search_value = '' or pg_catalog.length(search_value) > 64 then return; end if;
  if search_value ~* '^SC-' then
    if search_value !~* '^SC-[0-9]{8}-([0-9]{5}|[1-9][0-9]{3,})$' then return; end if;
    return query select o.order_number, o.created_at, o.status, o.cancellation_reason
      from public.orders as o
     where o.order_number = pg_catalog.upper(search_value) and o.payment_status = 'paid'
     order by o.created_at desc limit 1;
    return;
  end if;
  phone_digits := pg_catalog.regexp_replace(search_value, '[^0-9]', '', 'g');
  if pg_catalog.left(search_value, 1) = '+' then normalized_phone := phone_digits;
  elsif pg_catalog.left(phone_digits, 1) = '0' then normalized_phone := '880' || pg_catalog.substr(phone_digits, 2);
  elsif pg_catalog.left(phone_digits, 3) = '880' then normalized_phone := phone_digits;
  elsif pg_catalog.length(phone_digits) <= 10 then normalized_phone := '880' || phone_digits;
  else normalized_phone := phone_digits;
  end if;
  if normalized_phone !~ '^[0-9]{8,15}$' then return; end if;
  return query select o.order_number, o.created_at, o.status, o.cancellation_reason
    from public.orders as o
   where o.payment_status = 'paid'
     and pg_catalog.regexp_replace(o.customer_phone, '[^0-9]', '', 'g') = normalized_phone
   order by o.created_at desc, o.order_number desc;
end;
$$;
revoke all on function public.track_campaign_orders(text) from public;
grant execute on function public.track_campaign_orders(text) to anon, authenticated;
