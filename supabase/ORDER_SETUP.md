# Supabase order setup

## Install or update the database

`supabase/setup.sql` is the consolidated setup file. Run the complete file in Supabase Dashboard → SQL Editor. It applies the base schema, payment-required UddoktaPay flow, order tracking, admin-created offline orders, Processing timers, cancellation reasons, Make webhook queue, and the temporary expiry-test RPC. It also updates the old trigger/RPC definitions. The SQL can be rerun to refresh the installed functions and policies; the scheduled order timer is rescheduled by the script.

Before running it, enable Supabase Vault if needed. The script enables `pg_net` and `pg_cron`. Add a Vault secret named `make_order_webhook_url` whose value is your Make custom webhook URL. Keep Green API credentials only in Make, never in SQL or this repository.

For current installations, run the entire updated `setup.sql` once in SQL Editor to add the cancellation-reason field, public tracker field, and cancellation notification event. Ensure the Make scenario routes include the new `order_cancelled` event after the SQL runs.

## Admin orders and public tracking

Sign in at `/admin/`, then open `/admin/orders.html`. Admin access is enforced with the `site_admin` app-metadata role and orders table RLS. When the status is changed to **Cancelled**, enter a cancellation reason and save it. The public tracker shows that reason on the cancelled order card.

The tracker accepts an order ID or customer phone number. Phone searches return the customer's orders newest first. It returns only public tracking fields and never returns phone numbers or campaign details.

## Green API and Make

The Make webhook receives phone numbers as international digits without `+`: `01570284251` becomes `8801570284251`. Make appends `@c.us` when constructing Green API's `chatId`, such as `8801570284251@c.us`.

Use [`MAKE_GREEN_API_SETUP.md`](MAKE_GREEN_API_SETUP.md) for exact event routes, Green API request URL/body mappings, and troubleshooting. New orders include separate `customer_message` and `author_message` fields. Processing, expiry, completion, and cancellation events include the customer `message` field. The order ID is inserted into the message text by Supabase.

The database queues lifecycle events and retries explicit request failures. A `200 Accepted` response only means Make accepted the webhook; inspect its scenario history and Green API response/message logs for final delivery.

Confirm the automated completion/reminder job is active with:

```sql
select jobid, jobname, schedule, command
from cron.job
where jobname = 'campaign-order-duration-timers';
```

The test reminder helper sends a real WhatsApp message. Remove the temporary test button after use and drop its RPC with:

```sql
drop function if exists public.send_test_campaign_order_expiry_reminder(uuid);
```
