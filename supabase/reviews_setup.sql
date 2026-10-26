-- Run this once in Supabase Dashboard > SQL Editor to enable public reviews.
-- WhatsApp numbers are stored for repeat-submission limits but are never returned
-- in full by the public review-list RPC.

create table if not exists public.customer_reviews (
  id uuid primary key default gen_random_uuid(),
  whatsapp_phone text not null,
  review_message text not null,
  created_at timestamptz not null default now()
);

create index if not exists customer_reviews_recent_idx
  on public.customer_reviews (created_at desc);

alter table public.customer_reviews enable row level security;
revoke all on public.customer_reviews from public, anon, authenticated;

create or replace function public.list_public_reviews()
returns table (
  id uuid,
  reviewer_label text,
  review_message text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         'WhatsApp ••••' || pg_catalog.right(r.whatsapp_phone, 4),
         r.review_message,
         r.created_at
    from public.customer_reviews as r
   order by r.created_at desc
   limit 30;
$$;

create or replace function public.submit_public_review(
  p_whatsapp_number text,
  p_review_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  phone_input text := pg_catalog.btrim(coalesce(p_whatsapp_number, ''));
  phone_digits text;
  clean_message text := pg_catalog.btrim(coalesce(p_review_message, ''));
begin
  phone_digits := pg_catalog.regexp_replace(phone_input, '[^0-9]', '', 'g');
  if phone_input like '00%' then
    phone_digits := pg_catalog.substr(phone_digits, 3);
  elsif pg_catalog.left(phone_digits, 1) = '0' then
    phone_digits := '880' || pg_catalog.substr(phone_digits, 2);
  elsif pg_catalog.left(phone_digits, 3) <> '880'
        and pg_catalog.length(phone_digits) <= 10 then
    -- Accept a Bangladeshi local number without its leading trunk zero.
    phone_digits := '880' || phone_digits;
  end if;

  if phone_digits !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'সঠিক WhatsApp নম্বর দিন, দেশের কান্ট্রি কোডসহ।' using errcode = '22023';
  end if;
  if pg_catalog.length(clean_message) < 10 or pg_catalog.length(clean_message) > 1000 then
    raise exception 'রিভিউ ১০ থেকে ১০০০ অক্ষরের মধ্যে লিখুন।' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(phone_digits, 0));
  if exists (
    select 1
      from public.customer_reviews as r
     where r.whatsapp_phone = '+' || phone_digits
       and r.created_at >= now() - interval '24 hours'
  ) then
    raise exception 'এই নম্বর থেকে ২৪ ঘণ্টার মধ্যে একটি রিভিউ জমা দেওয়া হয়েছে।' using errcode = '22023';
  end if;

  insert into public.customer_reviews (whatsapp_phone, review_message)
  values ('+' || phone_digits, clean_message);
end;
$$;

revoke all on function public.list_public_reviews() from public;
revoke all on function public.submit_public_review(text, text) from public;
grant execute on function public.list_public_reviews() to anon, authenticated;
grant execute on function public.submit_public_review(text, text) to anon, authenticated;
