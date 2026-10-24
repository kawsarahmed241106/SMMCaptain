import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "POST is required." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("UDDOKTAPAY_API_KEY");
  if (!supabaseUrl || !serviceRoleKey || !apiKey) {
    console.error("Supabase or UddoktaPay function secrets are missing.");
    return respond(503, { error: "Payment verification is not configured yet." });
  }

  let body: { invoice_id?: string; checkout_token?: string };
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "Invalid request body." });
  }
  const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id.trim() : "";
  const checkoutToken = typeof body.checkout_token === "string" ? body.checkout_token : "";
  if (!invoiceId || invoiceId.length > 200 || !/^[\w-]+$/.test(invoiceId)) {
    return respond(400, { error: "Invalid payment reference." });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutToken)) {
    return respond(400, { error: "Invalid checkout reference." });
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: order, error: orderError } = await db
    .from("orders")
    .select("id, order_number, payment_status, payment_amount, payment_invoice_id")
    .eq("payment_token", checkoutToken)
    .maybeSingle();
  if (orderError) {
    console.error("Could not load order for payment verification:", orderError.message);
    return respond(500, { error: "Could not verify this payment." });
  }
  if (!order) return respond(404, { error: "Order not found." });
  if (order.payment_status === "paid" && order.payment_invoice_id === invoiceId) {
    return respond(200, { payment_status: "paid", order_number: order.order_number });
  }
  if (!order.payment_amount) return respond(409, { error: "This order does not have a payment amount yet." });

  try {
    const verifyResponse = await fetch("https://smmcaptain.paymently.io/api/verify-payment", {
      method: "POST",
      headers: {
        "RT-UDDOKTAPAY-API-KEY": apiKey,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ invoice_id: invoiceId }),
      signal: AbortSignal.timeout(20000),
    });
    const payment = await verifyResponse.json().catch(() => ({}));
    if (!verifyResponse.ok || payment.invoice_id !== invoiceId) {
      return respond(502, { error: "UddoktaPay could not verify this payment reference." });
    }

    const metadataOrderId = String(payment.metadata?.order_id ?? "");
    if (metadataOrderId !== order.id) {
      return respond(403, { error: "Payment reference does not match this order." });
    }
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || Math.abs(amount - Number(order.payment_amount)) > 0.01) {
      return respond(409, { error: "The verified payment amount does not match this order." });
    }

    const status = String(payment.status ?? "").toUpperCase();
    if (status === "COMPLETED") {
      const { error: updateError } = await db.from("orders").update({
        payment_status: "paid",
        payment_invoice_id: invoiceId,
        payment_method: typeof payment.payment_method === "string" ? payment.payment_method : null,
        payment_transaction_id: typeof payment.transaction_id === "string" ? payment.transaction_id : null,
        paid_at: new Date().toISOString(),
      }).eq("id", order.id);
      if (updateError) throw updateError;
      return respond(200, { payment_status: "paid", order_number: order.order_number });
    }

    if (status === "PENDING") {
      await db.from("orders").update({ payment_invoice_id: invoiceId, payment_status: "pending" }).eq("id", order.id);
      return respond(200, { payment_status: "pending", order_number: order.order_number });
    }
    return respond(200, { payment_status: "unpaid", order_number: order.order_number });
  } catch (error) {
    console.error("UddoktaPay payment verification failed:", error instanceof Error ? error.message : "Unknown error");
    return respond(502, { error: "Payment verification failed. Please check again shortly." });
  }
});
