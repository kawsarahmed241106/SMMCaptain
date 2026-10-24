# Supabase setup

The frontend is configured for the Supabase project URL and publishable key provided for SMMCaptain. The publishable key is public by design; database access is limited by Row Level Security.

1. Under **Authentication → Settings**, turn off public sign-ups.
2. Under **Authentication → Users**, create `smmcaptain@gmail.com` with a strong password. These are the credentials for `/admin/`.
3. In the Supabase Dashboard for this project, open **SQL Editor**, paste and run `setup.sql`. Its final statement grants `site_admin` to `smmcaptain@gmail.com`. If you already ran the setup file before creating this user, run it again now.
4. Open `/admin/`, sign in with that email/password, edit the fields, and choose **Save changes**. Visit or reload the main page to see the published values.

If Admin shows a row-level security error when saving, confirm that the SQL statement assigned the `site_admin` role to the exact admin email. Then log out of Admin and sign in again so Supabase issues a fresh access token with the updated role.

Only a Supabase user with the server-controlled `site_admin` app-metadata role can insert or update the settings row. The public page can read the single settings row. Never put a Supabase secret or service-role key in browser files.

## Rotate the active publishable key

The admin page's **Supabase publishable key** field changes the active client key for this same project. Create an additional publishable key in **Project Settings → API Keys**, enter it in the admin page, and save. The app fetches this setting through the bootstrap client and then uses the new active key for its settings request.

Keep the bootstrap key in `supabase-config.js` enabled. The browser needs it to fetch the active key from the database on startup, so deleting or revoking the bootstrap key will prevent the app from retrieving updated settings. Both keys are publishable keys; do not enter a secret/service-role key. This flow rotates keys within the configured project; it does not migrate the site to another Supabase project.
