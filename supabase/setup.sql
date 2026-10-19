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
