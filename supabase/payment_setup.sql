-- Run this migration in Supabase Dashboard > SQL Editor after setup.sql.
-- Payment API credentials belong in Supabase Edge Function secrets, never here.

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

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_status_check'
  ) then
    alter table public.orders
      add constraint orders_payment_status_check
      check (payment_status in ('unpaid', 'creating', 'pending', 'paid', 'failed', 'cancelled'));
  end if;
end
$$;

create index if not exists orders_payment_status_created_idx
  on public.orders (payment_status, created_at desc);

-- Keep the payment amount based on the current admin exchange-rate setting,
-- never on a price or rate supplied by the browser.
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
grant execute on function public.create_campaign_order(text, text, jsonb) to anon, authenticated;
