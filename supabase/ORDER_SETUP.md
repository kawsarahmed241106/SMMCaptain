# Order submission setup

## 1. Create the order tables and RPC

Run `supabase/setup.sql` in the Supabase Dashboard SQL Editor. The script adds:

- A private `orders` table that only site admins can read.
- A public `create_campaign_order` RPC that validates the contact information, creates a daily sequence ID such as `SC-20261020-1041`, and stores the submitted campaign details. The sequence starts at 1041 each day.
- A daily counter so IDs remain unique when several orders arrive at the same time.

The browser can execute the RPC, but it has no direct permission to browse, update, or delete order rows.

## 2. Use the admin orders page

Sign in at `/admin/`, then open `/admin/orders.html` or choose **View orders** in the admin header. Order visibility is enforced by the `site_admin` app-metadata role and the table's row-level security policy.

## 3. Enable order tracking and WhatsApp alerts

The setup SQL creates the `/track` lookup RPC and an `orders` insert trigger. The tracker only returns the order number, status, and submitted time; it does not expose phone numbers or campaign details.

Before running `supabase/setup.sql`, enable the **Vault** extension in the Supabase Dashboard if it is not already enabled. The SQL enables `pg_net`. Then add a Vault secret named `make_order_webhook_url` and set its value to the Make custom webhook URL. Do not put this URL or the UltraMsg token in the repository.

In Make, create a **Custom webhook** and use its URL as the Vault secret. Add a router with two HTTP request branches to UltraMsg's `POST https://api.ultramsg.com/instance195209/messages/chat` endpoint. Set each request's content type to `application/x-www-form-urlencoded`, and provide `token`, `to`, and `body` fields. Keep the token in Make's protected connection/secret storage.

Set the recipient for the author notification in Admin → **WhatsApp order alerts**. Enter the complete international number (for example, `+8801843161825`) and save. New order webhooks read this number from the `author_phone` setting in Supabase; the SQL keeps the existing number as a fallback until a value is saved.

Map `customer_phone` and this message on the customer branch:

```text
Your order was submitted successfully.
Your Order ID: {{order_id}}
Track your order: {{track_url}}
```

Map `author_phone` and this message on the author branch:

```text
New order submitted
Order ID: {{order_id}}
```

The Supabase trigger posts only the order number, customer and author WhatsApp numbers, event ID, and tracking URL. It queues the webhook after the order transaction commits, so a messaging outage does not undo a saved order.
