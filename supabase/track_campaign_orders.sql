-- Run in Supabase Dashboard > SQL Editor after the order/payment setup scripts.
-- Lets public users track a paid order by order ID or customer phone number.
-- Only returns order ID, created time, and status; campaign and contact details
-- remain private. Phone matches are returned newest first.

drop function if exists public.track_campaign_orders(text);
create function public.track_campaign_orders(p_search text)
returns table (order_number text, created_at timestamptz, status text, cancellation_reason text)
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
  if search_value = '' or pg_catalog.length(search_value) > 64 then
    return;
  end if;

  if search_value ~* '^SC-' then
    if search_value !~* '^SC-[0-9]{8}-([0-9]{5}|[1-9][0-9]{3,})$' then
      return;
    end if;

    return query
      select o.order_number, o.created_at, o.status, o.cancellation_reason
        from public.orders as o
       where o.order_number = pg_catalog.upper(search_value)
         and o.payment_status = 'paid'
       order by o.created_at desc
       limit 1;
    return;
  end if;

  phone_digits := pg_catalog.regexp_replace(search_value, '[^0-9]', '', 'g');
  if pg_catalog.left(search_value, 1) = '+' then
    normalized_phone := phone_digits;
  elsif pg_catalog.left(phone_digits, 1) = '0' then
    normalized_phone := '880' || pg_catalog.substr(phone_digits, 2);
  elsif pg_catalog.left(phone_digits, 3) = '880' then
    normalized_phone := phone_digits;
  elsif pg_catalog.length(phone_digits) <= 10 then
    normalized_phone := '880' || phone_digits;
  else
    normalized_phone := phone_digits;
  end if;

  if normalized_phone !~ '^[0-9]{8,15}$' then
    return;
  end if;

  return query
    select o.order_number, o.created_at, o.status, o.cancellation_reason
      from public.orders as o
     where o.payment_status = 'paid'
       and pg_catalog.regexp_replace(o.customer_phone, '[^0-9]', '', 'g') = normalized_phone
     order by o.created_at desc, o.order_number desc;
end;
$$;

revoke all on function public.track_campaign_orders(text) from public;
grant execute on function public.track_campaign_orders(text) to anon, authenticated;
