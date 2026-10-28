-- Apply the approved Bengali site copy and require a campaign location.
insert into public.site_settings (id, settings)
values (1, jsonb_build_object(
  'topNote', 'বুস্ট করুন খুব সহজে',
  'heroEyebrow', 'সহজ অনলাইন বিজ্ঞাপন',
  'heroTitle', 'এখন আপনার বিজনেসের জন্য বুস্ট বা অ্যাড রান করুন আপনি নিজেই।',
  'heroDescription', 'পোস্ট বা ভিডিওর লিংক দিয়ে আপনি নিজেই এখন বুস্ট করতে পারবেন। আপনার পছন্দমতো কাস্টমার বেছে নিতে পারবেন। বাজেট, দিনের সংখ্যা এবং অন্যান্য সেটিংস নিজেই ঠিক করতে পারবেন। সবকিছু সেট করা হয়ে গেলে নিজেই বুস্টের অর্ডার সাবমিট করতে পারবেন।',
  'exchangeRateNote', '— এক্সট্রা কোনো সার্ভিস চার্জ নেই।',
  'instructionVideo', 'https://youtu.be/O_YPBHqmFxQ?si=zcvCkVSxzFRAY7DM'
))
on conflict (id) do update
set settings = public.site_settings.settings || excluded.settings,
    updated_at = now();

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
