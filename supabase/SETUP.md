# Supabase setup

The frontend is configured for the Supabase project URL and publishable key provided for SMMCaptain. The publishable key is public by design; database access is limited by Row Level Security.

1. In the Supabase Dashboard for this project, open **SQL Editor**, paste and run `setup.sql`.
2. Under **Authentication → Settings**, turn off public sign-ups.
3. Under **Authentication → Users**, create the admin user with an email and a strong password. These are the credentials for `/admin/`.
4. Copy that user's UUID, open SQL Editor, replace `ADMIN_USER_UUID` below with the UUID, and run:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
       || '{"role":"site_admin"}'::jsonb
   where id = 'ADMIN_USER_UUID'::uuid;
   ```

5. Open `/admin/`, sign in with that email/password, edit the fields, and choose **Save changes**. Visit or reload the main page to see the published values.

Only a Supabase user with the server-controlled `site_admin` app-metadata role can insert or update the settings row. The public page can read the single settings row. Never put a Supabase secret or service-role key in browser files.
