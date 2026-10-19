// This bootstrap publishable key must remain active so the app can retrieve the
// current active key stored in site_settings. Both values are public by design.
// Access control is enforced by the database RLS policies in supabase/setup.sql.
window.smmSupabaseUrl = 'https://oumcdspxvpsfmbnbggid.supabase.co';
window.smmSupabaseBootstrapKey = 'sb_publishable__0DjxaH3MYQ_QNUeIoptNQ_0eoC6538';
window.createSmmSupabaseClient = (publishableKey = window.smmSupabaseBootstrapKey) =>
  window.supabase.createClient(window.smmSupabaseUrl, publishableKey);
window.smmSupabaseBootstrap = window.createSmmSupabaseClient();
// The bootstrap client retrieves the active publishable key from the settings row.
window.smmSupabaseClient = window.smmSupabaseBootstrap;
