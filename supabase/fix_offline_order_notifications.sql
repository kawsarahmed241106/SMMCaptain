-- Run in Supabase Dashboard > SQL Editor.
-- Repair the live trigger if it still excludes admin-entered offline orders.

drop trigger if exists orders_notify_make on public.orders;

create trigger orders_notify_make
  after insert on public.orders
  for each row
  execute function public.notify_make_new_order();

-- Confirm that the trigger has no WHEN filter excluding offline orders.
select pg_catalog.pg_get_triggerdef(trigger_row.oid) as trigger_definition
  from pg_catalog.pg_trigger as trigger_row
 where trigger_row.tgrelid = 'public.orders'::regclass
   and trigger_row.tgname = 'orders_notify_make'
   and not trigger_row.tgisinternal;

-- Check that Make's webhook URL is configured in Supabase Vault without showing it.
select exists (
  select 1
    from vault.decrypted_secrets as secret
   where secret.name = 'make_order_webhook_url'
     and nullif(pg_catalog.btrim(secret.decrypted_secret), '') is not null
) as make_webhook_is_configured;
