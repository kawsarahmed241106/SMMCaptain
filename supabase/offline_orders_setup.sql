-- Run in Supabase Dashboard > SQL Editor to enable admin-created offline orders.
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
