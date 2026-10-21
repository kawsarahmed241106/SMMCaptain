# Order submission setup

## 1. Create the order tables and RPC

Run `supabase/setup.sql` in the Supabase Dashboard SQL Editor. The script adds:

- A private `orders` table that only site admins can read.
- A public `create_campaign_order` RPC that validates the contact information, creates a date-based ID such as `SC-20261020-00001`, and stores the submitted campaign details.
- A daily counter so IDs remain unique when several orders arrive at the same time.

The browser can execute the RPC, but it has no direct permission to browse, update, or delete order rows.

## 2. Configure order confirmation email

The email function uses Resend. Verify a sending domain in Resend and create an API key. Keep the API key and Supabase service role key out of the browser and source control. Supabase provides `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions.

From the repository root, link the project, set the Resend secrets, and deploy the function:

```sh
supabase link --project-ref oumcdspxvpsfmbnbggid
supabase secrets set RESEND_API_KEY=re_your_key 'ORDER_FROM_EMAIL=SMMCaptain Orders <orders@your-verified-domain.com>'
supabase secrets set ORDER_NOTIFICATION_EMAIL=admin@example.com
supabase functions deploy send-order-email
```

`ORDER_NOTIFICATION_EMAIL` is optional. If set, the admin receives a blind copy of the customer confirmation. The function looks up the saved order by its UUID and sends to the email stored with that order, rather than trusting a recipient address from the browser. The order email includes the generated order number.

The function is configured for public invocation because a visitor submits orders without an account. It only sends email for a UUID that exists in the private orders table and claims each email job once to prevent duplicate sends.

## 3. Use the admin orders page

Sign in at `/admin/`, then open `/admin/orders.html` or choose **View orders** in the admin header. Order visibility is enforced by the `site_admin` app-metadata role and the table's row-level security policy.

Orders are stored even if the email provider is temporarily unavailable. In that case the customer sees the order ID and a message that email delivery is pending; the admin page shows the email status.
