-- SMMCaptain complete Supabase setup. Run this file in Supabase SQL Editor.
-- It installs the base schema, paid checkout flow, tracking, lifecycle notifications, offline orders, and the temporary expiry-test RPC.
-- Re-running refreshes the setup functions/policies and reschedules the order timer job.

-- SECTION 1: Base schema, roles, and new-order notifications
-- Run this file in Supabase Dashboard > SQL Editor.
-- Create the admin user under Authentication > Users and disable public sign-ups.
-- Run the role assignment at the bottom after that user exists.

create table if not exists public.site_settings (
  id smallint primary key check (id = 1),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Remove the retired hero eyebrow copy from the saved public settings.
update public.site_settings
set settings = settings - 'heroEyebrow',
    updated_at = now()
where settings ? 'heroEyebrow';

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

-- Orders are created only after verified payment finalization or through the admin-only offline order RPC.
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
  add column if not exists paid_at timestamptz,
  add column if not exists cancellation_reason text;

alter table public.orders drop constraint if exists orders_cancel_reason_required;
alter table public.orders add constraint orders_cancel_reason_required
  check (status <> 'cancelled' or nullif(pg_catalog.btrim(cancellation_reason), '') is not null) not valid;

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
grant update (status, cancellation_reason) on public.orders to authenticated;
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

drop trigger if exists orders_notify_make on public.orders;
create trigger orders_notify_make
  after insert on public.orders
  for each row execute function public.notify_make_new_order();

-- SECTION 2: Payment schema and order policies
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

-- Keep order status consistent whether this migration is run before or after
-- the base setup. Existing `new` orders are displayed as Pending.
alter table public.orders alter column status set default 'pending';
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders drop constraint if exists orders_status_workflow_check;
update public.orders set status = 'pending' where status = 'new';
alter table public.orders add constraint orders_status_workflow_check
  check (status in ('pending', 'processing', 'completed', 'cancelled'));

grant update (status) on public.orders to authenticated;
grant delete on public.orders to authenticated;
drop policy if exists "Site admins can update order status" on public.orders;
create policy "Site admins can update order status"
  on public.orders for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin');

drop policy if exists "Site admins can delete orders" on public.orders;
create policy "Site admins can delete orders"
  on public.orders for delete to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin');

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

-- SECTION 3: Payment-required checkout and public tracking RPC
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

-- SECTION 4: Order durations, status notifications, and public tracking details
-- It starts the order timer when an admin changes status to Processing,
-- sends lifecycle events through the existing Make webhook, and schedules
-- reminders/completion checks every 10 seconds using Supabase Cron.

create extension if not exists pg_cron;

alter table public.orders
  add column if not exists processing_started_at timestamptz,
  add column if not exists completion_at timestamptz,
  add column if not exists expiry_reminder_sent_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancellation_reason text;
grant update (status, cancellation_reason) on public.orders to authenticated;
alter table public.orders drop constraint if exists orders_cancel_reason_required;
alter table public.orders add constraint orders_cancel_reason_required
  check (status <> 'cancelled' or nullif(pg_catalog.btrim(cancellation_reason), '') is not null) not valid;

create index if not exists orders_processing_completion_idx
  on public.orders (completion_at)
  where status = 'processing';

create table if not exists public.order_notification_queue (
  id bigint generated by default as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null check (event_type in ('processing_started', 'expiry_reminder', 'order_completed', 'order_cancelled')),
  message text not null,
  queued_at timestamptz not null default clock_timestamp(),
  next_attempt_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0,
  request_id bigint,
  request_sent_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  unique (order_id, event_type)
);

alter table public.order_notification_queue
  drop constraint if exists order_notification_queue_event_type_check;
alter table public.order_notification_queue
  add constraint order_notification_queue_event_type_check
  check (event_type in ('processing_started', 'expiry_reminder', 'order_completed', 'order_cancelled'));

alter table public.order_notification_queue enable row level security;
revoke all on public.order_notification_queue from public, anon, authenticated;
grant all on public.order_notification_queue to service_role;
create index if not exists order_notification_queue_pending_idx
  on public.order_notification_queue (next_attempt_at, queued_at)
  where delivered_at is null and attempt_count < 5;

-- Existing orders already in Processing start their timer when this migration runs.
update public.orders as o
   set processing_started_at = coalesce(o.processing_started_at, clock_timestamp()),
       completion_at = coalesce(
         o.completion_at,
         coalesce(o.processing_started_at, clock_timestamp())
           + ((o.details->>'days')::integer * interval '1 day')
       )
 where o.status = 'processing'
   and coalesce(o.details->>'days', '') ~ '^[0-9]{1,3}$'
   and (o.details->>'days')::integer between 1 and 365
   and o.completion_at is null;

create or replace function public.start_campaign_order_timer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  duration_days integer;
begin
  if new.status = 'processing' and old.status is distinct from new.status then
    if coalesce(new.details->>'days', '') !~ '^[0-9]{1,3}$' then
      raise exception 'Cannot start processing: this order has no valid duration.' using errcode = '22023';
    end if;
    duration_days := (new.details->>'days')::integer;
    if duration_days < 1 or duration_days > 365 then
      raise exception 'Cannot start processing: order duration must be between 1 and 365 days.' using errcode = '22023';
    end if;

    new.processing_started_at := clock_timestamp();
    new.completion_at := new.processing_started_at + duration_days * interval '1 day';
    new.expiry_reminder_sent_at := null;
    new.completed_at := null;
  elsif new.status = 'completed' and old.status is distinct from new.status then
    new.completed_at := coalesce(new.completed_at, clock_timestamp());
  end if;
  return new;
end;
$$;

drop trigger if exists orders_start_duration_timer on public.orders;
create trigger orders_start_duration_timer
  before update of status on public.orders
  for each row execute function public.start_campaign_order_timer();

create or replace function public.enqueue_order_lifecycle_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'processing' and old.status is distinct from new.status then
    insert into public.order_notification_queue (order_id, event_type, message)
    values (new.id, 'processing_started', 'আপনার Boost / Ad Run-এর কাজ শুরু হয়ে গেছে। সর্বোচ্চ ১–২ ঘণ্টার মধ্যে ক্যাম্পেইন অ্যাক্টিভ হয়ে যাবে। অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন।' || E'\n\n' ||
      '🎬 বুস্টের রেজাল্ট কীভাবে দেখবেন বুঝতে না পারলে নিচের ভিডিওটি দেখুন:' || E'\n' ||
      'https://youtu.be/uJWi-3a5Iss' || E'\n\n' ||
      'কোনো কিছু জানার থাকলে বা সাহায্যের প্রয়োজন হলে আমাদের মেসেজ করবেন। 😊')
    on conflict (order_id, event_type) do nothing;
  elsif new.status = 'completed' and old.status is distinct from new.status then
    insert into public.order_notification_queue (order_id, event_type, message)
    values (new.id, 'order_completed', E'✅ আপনার অর্ডারটি ইতিমধ্যে সফলভাবে সম্পন্ন হয়েছে।\n\n🆔 Order ID: ' || new.order_number || E'\n\n🎬 বুস্টের রেজাল্ট নিজেই দেখতে ভিডিওটি দেখুন:\nhttps://youtu.be/uJWi-3a5Iss\n\n🚀 আবার বুস্ট করতে এখনই ভিজিট করুন:\nhttps://smmcaptain.xyz/\n\nআমাদের সার্ভিস নেওয়ার জন্য ধন্যবাদ। ❤️')
    on conflict (order_id, event_type) do nothing;
  elsif new.status = 'cancelled' and old.status is distinct from new.status then
    insert into public.order_notification_queue (order_id, event_type, message)
    values (new.id, 'order_cancelled', E'❌ আপনার অর্ডারটি ক্যানসেল করা হয়েছে।\n\n🆔 Order ID: ' || new.order_number || E'\n\n📦 ক্যানসেলের কারণ বা বিস্তারিত আপডেট জানতে অর্ডারটি ট্র্যাক করুন:\nhttps://smmcaptain.xyz/track\n\n🎬 বুস্টের রেজাল্ট দেখতে ভিডিওটি দেখুন:\nhttps://youtu.be/uJWi-3a5Iss\n\n🚀 আবার বুস্ট করতে অর্ডার করুন:\nhttps://smmcaptain.xyz/\n\nকোনো কিছু জানতে বা সাহায্যের প্রয়োজন হলে আমাদের মেসেজ করুন।\n\nধন্যবাদ ❤️')
    on conflict (order_id, event_type) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_enqueue_lifecycle_notification on public.orders;
create trigger orders_enqueue_lifecycle_notification
  after update of status on public.orders
  for each row execute function public.enqueue_order_lifecycle_notification();

create or replace function public.process_campaign_order_timers()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row record;
  notification_row record;
  webhook_url text;
  customer_digits text;
  customer_phone_digits text;
  v_request_id bigint;
  dispatch_body jsonb;
begin
  -- One-day campaigns get a six-hour notice. Longer campaigns get a 24-hour notice.
  for order_row in
    select o.id, o.details
      from public.orders as o
     where o.status = 'processing'
       and o.completion_at > clock_timestamp()
       and o.expiry_reminder_sent_at is null
       and o.completion_at <= clock_timestamp() + case
         when (o.details->>'days') = '1' then interval '6 hours'
         else interval '24 hours'
       end
     order by o.completion_at
     limit 100
     for update of o skip locked
  loop
    insert into public.order_notification_queue (order_id, event_type, message)
    values (
      order_row.id,
      'expiry_reminder',
      case when (order_row.details->>'days') = '1'
        then 'আপনার Boost / Ad Campaign আগামী ৬ ঘণ্টার মধ্যে সম্পন্ন হয়ে যাবে।'
        else 'আপনার Boost / Ad Campaign আগামী ২৪ ঘণ্টার মধ্যে সম্পন্ন হয়ে যাবে।'
      end || E'\n\n' ||
      'বুস্টের সময় বা বাজেট বাড়াতে চাইলে আমাদের জানাবেন অথবা ওয়েবসাইট থেকে আবার অর্ডার করতে পারেন।' || E'\n' ||
      '🔗 https://smmcaptain.xyz/' || E'\n\n' ||
      '🎬 বুস্টের রেজাল্ট দেখার ভিডিও: https://youtu.be/uJWi-3a5Iss' || E'\n\n' ||
      'কোনো কিছু জানার থাকলে বা সাহায্যের প্রয়োজন হলে আমাদের মেসেজ করবেন। 😊'
    )
    on conflict (order_id, event_type) do nothing;

    update public.orders
       set expiry_reminder_sent_at = clock_timestamp()
     where id = order_row.id and expiry_reminder_sent_at is null;
  end loop;

  -- Complete campaigns as soon as their scheduled completion instant has passed.
  for order_row in
    select o.id
      from public.orders as o
     where o.status = 'processing'
       and o.completion_at is not null
       and o.completion_at <= clock_timestamp()
     order by o.completion_at
     limit 100
     for update of o skip locked
  loop
    update public.orders
       set status = 'completed'
     where id = order_row.id and status = 'processing';
  end loop;

  -- Mark webhook responses that succeeded; schedule retries for explicit failures.
  update public.order_notification_queue as q
     set delivered_at = r.created,
         request_id = null,
         last_error = null
    from net._http_response as r
   where q.request_id = r.id
     and q.delivered_at is null
     and r.status_code between 200 and 299
     and r.error_msg is null
     and coalesce(r.timed_out, false) = false;

  update public.order_notification_queue as q
     set request_id = null,
         next_attempt_at = clock_timestamp() + interval '30 seconds',
         last_error = coalesce(r.error_msg, 'Webhook returned HTTP ' || coalesce(r.status_code::text, 'error'))
    from net._http_response as r
   where q.request_id = r.id
     and q.delivered_at is null
     and (r.status_code is null or r.status_code not between 200 and 299 or r.error_msg is not null or coalesce(r.timed_out, false));

  select secret.decrypted_secret
    into webhook_url
    from vault.decrypted_secrets as secret
   where secret.name = 'make_order_webhook_url'
   limit 1;
  if webhook_url is null or webhook_url = '' then
    return;
  end if;

  for notification_row in
    select q.id, q.order_id, q.event_type, q.message, q.attempt_count,
           o.order_number, o.customer_phone, o.completion_at
      from public.order_notification_queue as q
      join public.orders as o on o.id = q.order_id
     where q.delivered_at is null
       and q.request_id is null
       and q.attempt_count < 5
       and q.next_attempt_at <= clock_timestamp()
     order by q.queued_at
     limit 50
     for update of q skip locked
  loop
    customer_digits := pg_catalog.regexp_replace(notification_row.customer_phone, '[^0-9]', '', 'g');
    customer_phone_digits := case
      when pg_catalog.left(pg_catalog.btrim(notification_row.customer_phone), 1) = '+' then customer_digits
      when customer_digits like '880%' then customer_digits
      when customer_digits like '0%' then '880' || pg_catalog.substr(customer_digits, 2)
      else '880' || customer_digits
    end;

    dispatch_body := pg_catalog.jsonb_build_object(
      'event', notification_row.event_type,
      'event_id', notification_row.order_id::text || ':' || notification_row.event_type,
      'order_id', notification_row.order_number,
      'customer_phone', customer_phone_digits,
      'message', notification_row.message,
      'cancellation_reason', (select o.cancellation_reason from public.orders as o where o.id = notification_row.order_id),
      'completion_at', notification_row.completion_at,
      'track_url', 'https://smmcaptain.xyz/track/'
    );

    begin
      v_request_id := net.http_post(
        url := webhook_url,
        body := dispatch_body,
        headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json'),
        timeout_milliseconds := 10000
      );
      update public.order_notification_queue
         set request_id = v_request_id,
             request_sent_at = clock_timestamp(),
             attempt_count = attempt_count + 1,
             last_error = null
       where id = notification_row.id;
    exception when others then
      update public.order_notification_queue
         set attempt_count = attempt_count + 1,
             next_attempt_at = clock_timestamp() + interval '30 seconds',
             last_error = sqlerrm
       where id = notification_row.id;
      raise warning 'Could not queue % notification for order %: %',
        notification_row.event_type, notification_row.order_number, sqlerrm;
    end;
  end loop;
end;
$$;

revoke all on function public.start_campaign_order_timer() from public, anon, authenticated;
revoke all on function public.enqueue_order_lifecycle_notification() from public, anon, authenticated;
revoke all on function public.process_campaign_order_timers() from public, anon, authenticated;

-- Replace the track RPC to expose timer timestamps, never the phone or details.
drop function if exists public.track_campaign_orders(text);
create function public.track_campaign_orders(p_search text)
returns table (
  order_number text,
  created_at timestamptz,
  status text,
  processing_started_at timestamptz,
  completion_at timestamptz,
  completed_at timestamptz,
  cancellation_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  search_value text := pg_catalog.btrim(coalesce(p_search, ''));
  phone_digits text;
  normalized_phone text;
begin
  if search_value = '' or pg_catalog.length(search_value) > 64 then return; end if;
  if search_value ~* '^SC-' then
    if search_value !~* '^SC-[0-9]{8}-([0-9]{5}|[1-9][0-9]{3,})$' then return; end if;
    return query select o.order_number, o.created_at, o.status, o.processing_started_at, o.completion_at, o.completed_at, o.cancellation_reason
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
  return query select o.order_number, o.created_at, o.status, o.processing_started_at, o.completion_at, o.completed_at, o.cancellation_reason
    from public.orders as o
   where o.payment_status = 'paid'
     and pg_catalog.regexp_replace(o.customer_phone, '[^0-9]', '', 'g') = normalized_phone
   order by o.created_at desc, o.order_number desc;
end;
$$;
revoke all on function public.track_campaign_orders(text) from public;
grant execute on function public.track_campaign_orders(text) to anon, authenticated;

-- Schedule a lightweight check every 10 seconds (the project is PostgreSQL 17).
do $$
declare
  existing_job record;
begin
  for existing_job in select jobid from cron.job where jobname = 'campaign-order-duration-timers' loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule(
    'campaign-order-duration-timers',
    '10 seconds',
    'select public.process_campaign_order_timers();'
  );
end;
$$;


-- SECTION 5: Admin-created offline orders
-- These orders share the regular dated order number sequence, start as Pending,
-- and send the same Make order/status notifications as online orders.

drop function if exists public.admin_create_offline_order(text, text, text, integer);
drop function if exists public.admin_create_offline_order(text, text, text, integer, text);

create or replace function public.admin_create_offline_order(
  p_customer_phone text,
  p_customer_name text,
  p_order_description text,
  p_duration_days integer,
  p_facebook_video_link text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  phone_input text := pg_catalog.btrim(coalesce(p_customer_phone, ''));
  phone_digits text;
  normalized_phone text;
  customer_name text := pg_catalog.btrim(coalesce(p_customer_name, ''));
  order_description text := pg_catalog.btrim(coalesce(p_order_description, ''));
  facebook_video_link text := pg_catalog.btrim(coalesce(p_facebook_video_link, ''));
  local_order_date date := (now() at time zone 'Asia/Dhaka')::date;
  sequence_number integer;
  generated_order_number text;
  created_order public.orders%rowtype;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'site_admin' then
    raise exception 'Site admin access is required.' using errcode = '42501';
  end if;

  phone_digits := pg_catalog.regexp_replace(phone_input, '[^0-9]', '', 'g');
  if phone_input like '00%' then
    phone_digits := pg_catalog.substr(phone_digits, 3);
  elsif pg_catalog.left(phone_digits, 1) = '0' then
    phone_digits := '880' || pg_catalog.substr(phone_digits, 2);
  elsif pg_catalog.left(phone_digits, 3) <> '880' and pg_catalog.length(phone_digits) <= 10 then
    phone_digits := '880' || phone_digits;
  end if;
  if phone_digits !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'Enter a valid customer WhatsApp number.' using errcode = '22023';
  end if;
  if pg_catalog.length(order_description) < 2 or pg_catalog.length(order_description) > 2000 then
    raise exception 'Order details must be between 2 and 2000 characters.' using errcode = '22023';
  end if;
  if p_duration_days is null or p_duration_days < 1 or p_duration_days > 365 then
    raise exception 'Duration must be between 1 and 365 days.' using errcode = '22023';
  end if;
  if pg_catalog.length(customer_name) > 120 then
    raise exception 'Customer name is too long.' using errcode = '22023';
  end if;
  if pg_catalog.length(facebook_video_link) > 2000
     or (facebook_video_link <> '' and facebook_video_link !~* '^https://([a-z0-9-]+\.)*facebook\.com(/|$)|^https://fb\.watch(/|$)') then
    raise exception 'Enter a valid HTTPS Facebook video or fb.watch link.' using errcode = '22023';
  end if;

  normalized_phone := '+' || phone_digits;

  insert into public.order_daily_counters (order_date, last_number)
  values (local_order_date, 1041)
  on conflict (order_date) do update
    set last_number = greatest(public.order_daily_counters.last_number + 1, 1041)
  returning last_number into sequence_number;

  generated_order_number := 'SC-' || pg_catalog.to_char(local_order_date, 'YYYYMMDD') || '-' || sequence_number::text;

  insert into public.orders (
    order_number,
    customer_phone,
    ad_whatsapp,
    details,
    status,
    payment_status,
    payment_method,
    paid_at
  ) values (
    generated_order_number,
    normalized_phone,
    '',
    pg_catalog.jsonb_build_object(
      'source', 'admin_offline',
      'customerName', nullif(customer_name, ''),
      'orderDescription', order_description,
      'postLink', nullif(facebook_video_link, ''),
      'days', p_duration_days,
      'paymentMethodLabel', 'Offline payment'
    ),
    'pending',
    'paid',
    'offline',
    now()
  ) returning * into created_order;

  return pg_catalog.jsonb_build_object(
    'order_id', created_order.id,
    'order_number', created_order.order_number,
    'created_at', created_order.created_at
  );
end;
$$;

revoke all on function public.admin_create_offline_order(text, text, text, integer, text) from public, anon;
grant execute on function public.admin_create_offline_order(text, text, text, integer, text) to authenticated;

-- Send the same Make order-confirmation event for offline orders as online orders.
drop trigger if exists orders_notify_make on public.orders;
create trigger orders_notify_make
  after insert on public.orders
  for each row
  execute function public.notify_make_new_order();


-- SECTION 6: Temporary expiry reminder test RPC
-- Temporary admin-only test helper for the Make expiry_reminder route.
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
    then 'আপনার Boost / Ad Campaign আগামী ৬ ঘণ্টার মধ্যে সম্পন্ন হয়ে যাবে।'
    else 'আপনার Boost / Ad Campaign আগামী ২৪ ঘণ্টার মধ্যে সম্পন্ন হয়ে যাবে।'
  end || E'\n\n' ||
    'বুস্টের সময় বা বাজেট বাড়াতে চাইলে আমাদের জানাবেন অথবা ওয়েবসাইট থেকে আবার অর্ডার করতে পারেন।' || E'\n' ||
    '🔗 https://smmcaptain.xyz/' || E'\n\n' ||
    '🎬 বুস্টের রেজাল্ট দেখার ভিডিও: https://youtu.be/uJWi-3a5Iss' || E'\n\n' ||
    'কোনো কিছু জানার থাকলে বা সাহায্যের প্রয়োজন হলে আমাদের মেসেজ করবেন। 😊';
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
