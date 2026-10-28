# Supabase setup

The frontend is configured for the Supabase project URL and publishable key provided for SMMCaptain. The publishable key is public by design; database access is limited by Row Level Security.

1. Under **Authentication → Settings**, turn off public sign-ups.
2. Under **Authentication → Users**, create the account you will use for `/admin/` with a strong password.
3. In the Supabase Dashboard for this project, open **SQL Editor** and run `setup.sql`. It includes a grant for the original account `smmcaptain@gmail.com`.
4. If you use a different admin email, or created the user after running `setup.sql`, grant that exact account the server-controlled admin role in SQL Editor. Replace the email below with the account's exact email, then run the query:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
       || '{"role":"site_admin"}'::jsonb
   where lower(email) = lower('your-admin@example.com');

   select email, raw_app_meta_data ->> 'role' as app_role
   from auth.users
   where lower(email) = lower('your-admin@example.com');
   ```

   Confirm the query returns the intended email and `site_admin`.
5. Open `/admin/`, sign in with that email/password, edit the fields, and choose **Save changes**. Visit or reload the main page to see the published values.

If Admin shows a row-level security error when saving, verify the role query above for the exact email used to sign in. Then log out of Admin and sign in again so Supabase issues a fresh access token with the updated role. Do not rerun the full setup just to add another admin; it also runs unrelated schema and order migrations.

Only a Supabase user with the server-controlled `site_admin` app-metadata role can insert or update the settings row. The public page can read the single settings row. Never put a Supabase secret or service-role key in browser files.

## Rotate the active publishable key

The admin page's **Supabase publishable key** field changes the active client key for this same project. Create an additional publishable key in **Project Settings → API Keys**, enter it in the admin page, and save. The app fetches this setting through the bootstrap client and then uses the new active key for its settings request.

Keep the bootstrap key in `supabase-config.js` enabled. The browser needs it to fetch the active key from the database, so deleting or revoking the bootstrap key will prevent the app from retrieving updated settings. Both keys are publishable keys; do not enter a secret/service-role key. This flow rotates keys within the configured project; it does not migrate the site to another Supabase project.
