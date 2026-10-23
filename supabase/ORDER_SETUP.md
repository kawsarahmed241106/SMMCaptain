# Order submission setup

## 1. Create the order tables and RPC

Run `supabase/setup.sql` in the Supabase Dashboard SQL Editor. The script adds:

- A private `orders` table that only site admins can read.
- A public `create_campaign_order` RPC that validates the contact information, creates a date-based ID such as `SC-20261020-00001`, and stores the submitted campaign details.
- A daily counter so IDs remain unique when several orders arrive at the same time.

The browser can execute the RPC, but it has no direct permission to browse, update, or delete order rows.

## 2. Use the admin orders page

Sign in at `/admin/`, then open `/admin/orders.html` or choose **View orders** in the admin header. Order visibility is enforced by the `site_admin` app-metadata role and the table's row-level security policy.

Orders are stored with the submitted WhatsApp contact number; no customer email is collected or sent.
