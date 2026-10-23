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
-- If this file was run before the user was created, run this block again afterward.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || '{"role":"site_admin"}'::jsonb
where email = 'smmcaptain@gmail.com';

-- Campaign orders are inserted through a database function so the browser can
-- submit orders without receiving permission to read or edit other customers' data.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  created_at timestamptz not null default now(),
  customer_email text,
  customer_phone text not null,
  ad_whatsapp text not null default '',
  details jsonb not null default '{}'::jsonb,
  status text not null default 'new'
    check (status in ('new', 'processing', 'completed', 'cancelled'))
);

alter table public.orders drop column if exists email_status;
alter table public.orders alter column customer_email drop not null;

create index if not exists orders_created_at_idx on public.orders (created_at desc);
alter table public.orders enable row level security;
revoke all on public.orders from public, anon, authenticated;
grant select on public.orders to authenticated;

drop policy if exists "Site admins can read orders" on public.orders;
create policy "Site admins can read orders"
  on public.orders for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin');

create table if not exists public.order_daily_counters (
  order_date date primary key,
  last_number integer not null
);
alter table public.order_daily_counters enable row level security;
revoke all on public.order_daily_counters from anon, authenticated;

drop function if exists public.create_campaign_order(text, text, text, jsonb);

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

  insert into public.order_daily_counters (order_date, last_number)
  values (local_order_date, 1)
  on conflict (order_date) do update
    set last_number = public.order_daily_counters.last_number + 1
  returning last_number into sequence_number;

  generated_order_number := 'SC-' || to_char(local_order_date, 'YYYYMMDD') || '-' || lpad(sequence_number::text, 5, '0');

  insert into public.orders (order_number, customer_phone, ad_whatsapp, details)
  values (generated_order_number, trim(p_customer_phone), coalesce(trim(p_ad_whatsapp), ''), p_details)
  returning * into created_order;

  return jsonb_build_object(
    'order_id', created_order.id,
    'order_number', created_order.order_number,
    'created_at', created_order.created_at
  );
end;
$$;

revoke all on function public.create_campaign_order(text, text, jsonb) from public;
grant execute on function public.create_campaign_order(text, text, jsonb) to anon, authenticated;
