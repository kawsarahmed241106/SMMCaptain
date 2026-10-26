# Order submission setup

## 1. Create the order tables and RPC

Run `supabase/setup.sql` in the Supabase Dashboard SQL Editor. Then run `supabase/payment_setup.sql` and `supabase/payment_required_order_flow.sql` in the same SQL Editor. The payment-required migration adds:

If the existing project has already run `setup.sql` and `payment_setup.sql`, run only `payment_required_order_flow.sql` to update it.

- A private checkout-intent table for temporary payment sessions. These are not submitted orders and are not visible to the admin orders page or order tracker.
- A `create_campaign_checkout_intent` RPC that validates the form and calculates the amount without inserting an order.
- A server-only finalizer that creates the numbered order only after UddoktaPay verification confirms a completed payment. Order IDs start at 1041 each day.
- Revoked browser access to the old `create_campaign_order` RPC, which inserted orders before payment.

The browser can create a temporary checkout intent, but it has no direct permission to read or edit checkout intents or order rows. Do not skip the payment-required migration; without it, the new checkout flow will not be available.

## 2. Use the admin orders page

Sign in at `/admin/`, then open `/admin/orders.html` or choose **View orders** in the admin header. Order visibility is enforced by the `site_admin` app-metadata role and the table's row-level security policy.

## 3. Enable order tracking and WhatsApp alerts

The setup SQL creates the `/track` lookup RPC and an `orders` insert trigger. The tracker only returns paid orders' number, status, and submitted time; phone numbers are used only to match a search and are never returned. A phone-number search returns all matching orders newest first. If the live database has already been set up, run `supabase/track_campaign_orders.sql` in the Supabase SQL Editor to enable phone-number searches. The notification trigger runs when the paid order is finalized, not when a customer starts checkout. If you have already run the original setup script, run `supabase/fix_make_notification_trim.sql` once to update the existing trigger function.

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

## 4. Order processing duration and automatic messages

After the payment and order SQL above is installed, run `supabase/automated_order_duration_notifications.sql` once in Supabase Dashboard → SQL Editor. It adds timer fields, starts the countdown only when an admin changes an order to **Processing**, and schedules a database check every 10 seconds. Expected completion is the Processing start time plus the selected duration in days. When that time is reached, the status changes to **Completed** automatically. The `/track` page shows the processing start, expected completion, and actual completion timestamps.

The migration adds three lifecycle events to the existing Make webhook. Add three routes/filters in Make for `processing_started`, `expiry_reminder`, and `order_completed`. On each route, send an UltraMsg WhatsApp message to `customer_phone` using the payload's `message` field. The messages are “Your order processing has started!”, “Your ad/order will expire in 24 hours.” (6 hours for a one-day order), and “Your order has been completed successfully.” A webhook acceptance from Make only confirms that Make accepted the request; check Make/UltraMsg delivery logs for final delivery. Use `event_id` to deduplicate retries if you add retries in Make.

Confirm the scheduled job exists with:

```sql
select jobid, jobname, schedule, command
from cron.job
where jobname = 'campaign-order-duration-timers';
```

The job must remain active for reminders and automatic completion to run. Supabase Cron supports sub-minute schedules on current PostgreSQL versions; the job polls every 10 seconds, then Make/UltraMsg network delivery time is additional.
