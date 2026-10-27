-- Disable public review listing and submissions while preserving existing review data.
-- Run in Supabase Dashboard > SQL Editor.

drop function if exists public.list_public_reviews();
drop function if exists public.submit_public_review(text, text);

-- The customer_reviews table is intentionally retained (and remains protected by RLS)
-- so existing review records are not irreversibly deleted.
