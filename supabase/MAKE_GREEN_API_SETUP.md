# Make.com + Green API WhatsApp setup

The Supabase webhook sends international phone digits without a plus sign. For example, a customer enters `01570284251`, the webhook contains `8801570284251`, and Make adds the Green API personal-chat suffix to create `8801570284251@c.us`.

Green API `SendMessage` uses a POST URL in this format:

```text
{{apiUrl}}/waInstance{{idInstance}}/SendMessage/{{apiTokenInstance}}
```

Use the API URL, instance ID, and token shown in your Green API instance. Green API's official request body uses `chatId` and `message`, and a personal chat ID uses the full phone number followed by `@c.us`:

- https://green-api.com/en/docs/request-format/
- https://green-api.com/en/docs/api/sending/SendMessage/
- https://green-api.com/en/docs/api/chat-id/

## Build the scenario

1. Keep the existing **Webhooks → Custom webhook** trigger. Use its webhook URL as the Supabase Vault secret `make_order_webhook_url`.
2. Click **Run once**, then create a test order and update test orders through Processing, Completed, and Cancelled so Make captures every event and its fields.
3. Add a **Router** after the webhook. Create routes with the filters and mappings below.
4. Add one **HTTP → Make a request** module after each route. Set method to `POST`, add the URL above, set **Body type** to `Raw`, **Content type** to `JSON (application/json)`, and use the JSON body shown below. Insert the mapped fields from the webhook in Make's mapping panel; append the literal `@c.us` after the phone token. Wrap every mapped message value in Make's `escapeJSON()` function so line breaks and other special characters remain valid inside the raw JSON body.
5. Keep the API token in a protected Make connection/secret. Do not put it in this repository or a public URL.
6. Turn the scenario **Active** and run a real test to verify each route in Make's scenario history and Green API's message logs.

## Routes and message fields

### New order to customer

Filter: `event` equals `new_order`.

```json
{
  "chatId": "{{customer_phone}}@c.us",
  "message": "{{escapeJSON(customer_message)}}"
}
```

### New order to author

Create a second route with the same `event = new_order` filter.

```json
{
  "chatId": "{{author_phone}}@c.us",
  "message": "{{escapeJSON(author_message)}}"
}
```

### Processing started

Filter: `event` equals `processing_started`.

```json
{
  "chatId": "{{customer_phone}}@c.us",
  "message": "{{escapeJSON(message)}}"
}
```

### Expiry reminder

Filter: `event` equals `expiry_reminder`. A one-day order receives its reminder six hours before completion; other orders receive it 24 hours before completion. The payload's `message` already reflects the matching reminder text.

```json
{
  "chatId": "{{customer_phone}}@c.us",
  "message": "{{escapeJSON(message)}}"
}
```

### Order completed

Filter: `event` equals `order_completed`.

```json
{
  "chatId": "{{customer_phone}}@c.us",
  "message": "{{escapeJSON(message)}}"
}
```

### Order cancelled

Filter: `event` equals `order_cancelled`.

```json
{
  "chatId": "{{customer_phone}}@c.us",
  "message": "{{escapeJSON(message)}}"
}
```

The cancellation reason is also included in `cancellation_reason` for reference. The customer can see it on the public order tracking card.

## Important mapping notes

- Use `chatId`, not `to`.
- Map the digits-only phone and append `@c.us`; do not add `+`, spaces, parentheses, or a leading local `0`.
- Map the full message field from the webhook. Supabase already inserts the order ID in the order-confirmation, completion, and cancellation messages.
- New-order user messages use `customer_message`; author messages use `author_message`. Status notifications use `message`.
- A successful Make webhook response means only that Make accepted the event. Verify the downstream HTTP module's result and Green API message logs to confirm sending.
