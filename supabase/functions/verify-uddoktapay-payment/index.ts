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
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!invoiceId || invoiceId.length > 200 || !/^[\w-]+$/.test(invoiceId)) {
    return respond(400, { error: "Invalid payment reference." });
  }
  if (!uuidPattern.test(checkoutToken)) return respond(400, { error: "Invalid checkout token." });

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: intent, error: intentError } = await db
    .from("order_payment_intents")
    .select("id, checkout_token, payment_status, payment_amount, payment_invoice_id, created_order_id")
    .eq("checkout_token", checkoutToken)
    .maybeSingle();
  if (intentError) {
    console.error("Could not load checkout session for verification:", intentError.message);
    return respond(500, { error: "Could not verify this payment." });
  }

  // Preserve in-flight checkout links issued before the payment-gated flow rollout.
  let legacyOrder: { id: string; order_number: string; payment_status: string; payment_amount: number | null; payment_invoice_id: string | null } | null = null;
  if (!intent) {
    const { data, error } = await db
      .from("orders")
      .select("id, order_number, payment_status, payment_amount, payment_invoice_id")
      .eq("payment_token", checkoutToken)
      .maybeSingle();
    if (error) {
      console.error("Could not load legacy order for payment verification:", error.message);
      return respond(500, { error: "Could not verify this payment." });
    }
    legacyOrder = data;
  }
  if (!intent && !legacyOrder) return respond(404, { error: "Payment session not found." });

  if (intent?.created_order_id && intent.payment_status === "paid" && intent.payment_invoice_id === invoiceId) {
    const { data: paidOrder, error } = await db.from("orders").select("order_number").eq("id", intent.created_order_id).maybeSingle();
    if (error || !paidOrder) return respond(500, { error: "The paid order could not be loaded." });
    return respond(200, { payment_status: "paid", order_number: paidOrder.order_number });
  }
  if (legacyOrder?.payment_status === "paid" && legacyOrder.payment_invoice_id === invoiceId) {
    return respond(200, { payment_status: "paid", order_number: legacyOrder.order_number });
  }

  const expectedAmount = intent?.payment_amount ?? legacyOrder?.payment_amount;
  if (!expectedAmount) return respond(409, { error: "This payment session has no valid amount." });

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

    if (intent) {
      const metadataCheckoutId = String(payment.metadata?.checkout_id ?? payment.metadata?.order_id ?? "");
      if (metadataCheckoutId !== intent.id) {
        return respond(403, { error: "Payment reference does not match this checkout." });
      }
    } else if (String(payment.metadata?.order_id ?? "") !== legacyOrder!.id) {
      return respond(403, { error: "Payment reference does not match this order." });
    }

    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || Math.abs(amount - Number(expectedAmount)) > 0.01) {
      return respond(409, { error: "The verified payment amount does not match this checkout." });
    }

    const paymentStatus = String(payment.status ?? "").toUpperCase();
    if (paymentStatus === "COMPLETED") {
      const paymentMethod = typeof payment.payment_method === "string" ? payment.payment_method : null;
      const transactionId = typeof payment.transaction_id === "string" ? payment.transaction_id : null;
      if (intent) {
        const { data: finalized, error } = await db.rpc("finalize_paid_campaign_order", {
          p_checkout_token: checkoutToken,
          p_invoice_id: invoiceId,
          p_payment_method: paymentMethod,
          p_transaction_id: transactionId,
        });
        if (error) throw error;
        const order = Array.isArray(finalized) ? finalized[0] : finalized;
        if (!order?.order_number) throw new Error("Paid checkout did not return a finalized order.");
        return respond(200, { payment_status: "paid", order_number: order.order_number });
      }

      const { error: updateError } = await db.from("orders").update({
        payment_status: "paid",
        payment_invoice_id: invoiceId,
        payment_method: paymentMethod,
        payment_transaction_id: transactionId,
        paid_at: new Date().toISOString(),
      }).eq("id", legacyOrder!.id);
      if (updateError) throw updateError;
      return respond(200, { payment_status: "paid", order_number: legacyOrder!.order_number });
    }

    if (paymentStatus === "PENDING") {
      if (intent) {
        const { error } = await db.from("order_payment_intents").update({ payment_invoice_id: invoiceId, payment_status: "pending" }).eq("id", intent.id);
        if (error) throw error;
        return respond(200, { payment_status: "pending" });
      }
      await db.from("orders").update({ payment_invoice_id: invoiceId, payment_status: "pending" }).eq("id", legacyOrder!.id);
      return respond(200, { payment_status: "pending", order_number: legacyOrder!.order_number });
    }

    if (intent) {
      const failedStatus = paymentStatus === "CANCELLED" ? "cancelled" : "failed";
      const { error } = await db.from("order_payment_intents").update({ payment_invoice_id: invoiceId, payment_status: failedStatus }).eq("id", intent.id);
      if (error) throw error;
      return respond(200, { payment_status: "unpaid" });
    }
    return respond(200, { payment_status: "unpaid", order_number: legacyOrder!.order_number });
  } catch (error) {
    console.error("UddoktaPay payment verification/finalization failed:", error instanceof Error ? error.message : "Unknown error");
    return respond(502, { error: "Payment verification failed. Please check again shortly." });
  }
});
