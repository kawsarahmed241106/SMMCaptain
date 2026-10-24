# UddoktaPay setup

The checkout sends orders to Supabase first, then creates a UddoktaPay payment link. No customer email field is used. UddoktaPay receives the fixed billing email `creativemasteritofficial@gmail.com` from the Edge Function secret `UDDOKTAPAY_BILLING_EMAIL`.

## One-time Supabase setup

1. In Supabase Dashboard → SQL Editor, run `supabase/payment_setup.sql` after the existing `supabase/setup.sql` migration. This adds payment tracking fields and updates the order RPC to calculate the amount using the admin exchange rate.
2. In Supabase Dashboard → Authentication → Sign In / Providers, enable **Anonymous Sign-Ins**. The website uses an anonymous Supabase session to call the payment functions; it does not ask buyers to create accounts.
3. In Supabase Dashboard → Edge Functions → Secrets, add:
   - `UDDOKTAPAY_API_KEY`: your private UddoktaPay API key.
   - `UDDOKTAPAY_BILLING_EMAIL`: `creativemasteritofficial@gmail.com`.

   Do not put the API key in website JavaScript, `supabase-config.js`, or GitHub. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions automatically; do not add either to the browser or commit them.
4. Deploy the functions from the repository root with the Supabase CLI:

   ```sh
   supabase functions deploy create-uddoktapay-checkout
   supabase functions deploy verify-uddoktapay-payment
   ```

   Keep JWT verification enabled. The page signs in anonymously before invoking the functions.
5. To deploy functions automatically on every push to `main`, add these GitHub repository Actions secrets under Settings → Secrets and variables → Actions:
   - `SUPABASE_ACCESS_TOKEN`: a Supabase personal access token.
   - `SUPABASE_PROJECT_ID`: `gpclmymbggvfflvictpz`.

   The workflow deploys the functions only. The SQL migration and Edge Function secrets above still need to be configured in Supabase.
6. Deploy the website files to `public_html`. The payment return page is `/payment-result.html`; the tracking page is `/track/`.

## Payment behavior

- The server creates the order and calculates its amount from the stored campaign budget and current admin dollar rate.
- The checkout function sends the fixed billing email and order metadata to `https://smmcaptain.paymently.io/api/checkout-v2`.
- The return page calls the verify function. An order is marked paid only after the gateway confirms the invoice, order metadata, and amount.
- Payment API requests run in Supabase Edge Functions. The API key is never sent to the browser.

UddoktaPay references: [Create Charge](https://uddoktapay.readme.io/reference/create-charge) · [Verify Payment](https://uddoktapay.readme.io/reference/verify-payment-api-guideline). Supabase references: [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) · [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets).
