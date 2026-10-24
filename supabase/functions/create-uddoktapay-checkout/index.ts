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
  const billingEmail = Deno.env.get("UDDOKTAPAY_BILLING_EMAIL")?.trim().toLowerCase() ?? "";
  if (!supabaseUrl || !serviceRoleKey || !apiKey || !billingEmail) {
    console.error("Supabase or UddoktaPay function secrets are missing.");
    return respond(503, { error: "Payment service is not configured yet." });
  }

  let body: { order_id?: string; checkout_token?: string };
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "Invalid request body." });
  }

  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const checkoutToken = typeof body.checkout_token === "string" ? body.checkout_token : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
    return respond(400, { error: "Invalid order reference." });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutToken)) {
    return respond(400, { error: "Invalid checkout reference." });
  }
  if (billingEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) {
    console.error("UDDOKTAPAY_BILLING_EMAIL is not a valid email address.");
    return respond(503, { error: "Payment service is not configured yet." });
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: order, error: orderError } = await db
    .from("orders")
    .select("id, order_number, details, customer_email, payment_status, payment_url, payment_amount")
    .eq("id", orderId)
    .eq("payment_token", checkoutToken)
    .maybeSingle();
  if (orderError) {
    console.error("Could not read order for checkout:", orderError.message);
    return respond(500, { error: "Could not prepare this order for payment." });
  }
  if (!order) return respond(404, { error: "Order not found. Please submit the order again." });
  if (order.payment_status === "paid") return respond(409, { error: "This order is already paid." });
  if (order.payment_status === "pending" && order.payment_url) {
    return respond(200, { payment_url: order.payment_url, order_number: order.order_number });
  }
  if (order.payment_status === "creating") {
    return respond(409, { error: "A payment link is already being prepared. Please wait a moment." });
  }

  const details = order.details as Record<string, unknown>;
  const dailyBudget = Number(details.dailyBudgetUsd);
  const days = Number(details.days);
  const dollarRate = Number(details.dollarRate);
  const amount = Number(details.totalBudgetBdt);
  if (!Number.isFinite(dailyBudget) || dailyBudget < 2 || dailyBudget > 1000 ||
      !Number.isInteger(days) || days < 1 || days > 365 ||
      dailyBudget * days < 10 || !Number.isFinite(dollarRate) || dollarRate < 1 ||
      !Number.isFinite(amount) || amount !== Math.round(dailyBudget * days * dollarRate * 100) / 100) {
    return respond(400, { error: "The saved order amount is invalid. Please contact support." });
  }

  const { data: claimedOrder, error: claimError } = await db
    .from("orders")
    .update({ payment_status: "creating", payment_attempted_at: new Date().toISOString() })
    .eq("id", orderId)
    .in("payment_status", ["unpaid", "failed", "cancelled"])
    .select("id")
    .maybeSingle();
  if (claimError) {
    console.error("Could not reserve order for checkout:", claimError.message);
    return respond(500, { error: "Could not start payment. Please try again." });
  }
  if (!claimedOrder) return respond(409, { error: "A payment attempt is already in progress. Please refresh and try again." });

  const origin = "https://smmcaptain.xyz";
  const resultUrl = `${origin}/payment-result.html?order_id=${encodeURIComponent(orderId)}&order_number=${encodeURIComponent(order.order_number)}&checkout_token=${encodeURIComponent(checkoutToken)}`;
  const checkoutPayload = {
    full_name: "SMMCaptain Customer",
    email: billingEmail,
    amount: amount.toFixed(2),
    metadata: { order_id: orderId, order_number: order.order_number },
    redirect_url: resultUrl,
    return_type: "GET",
    cancel_url: `${resultUrl}&payment=cancelled`,
  };

  try {
    const gatewayResponse = await fetch("https://smmcaptain.paymently.io/api/checkout-v2", {
      method: "POST",
      headers: {
        "RT-UDDOKTAPAY-API-KEY": apiKey,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(checkoutPayload),
      signal: AbortSignal.timeout(20000),
    });
    const gatewayData = await gatewayResponse.json().catch(() => ({}));
    const paymentUrl = typeof gatewayData.payment_url === "string" ? gatewayData.payment_url : "";
    let parsedPaymentUrl: URL | null = null;
    try { parsedPaymentUrl = new URL(paymentUrl); } catch { /* invalid URL is handled below */ }

    const trustedPaymentHost = parsedPaymentUrl && (
      parsedPaymentUrl.hostname === "smmcaptain.paymently.io" ||
      parsedPaymentUrl.hostname.endsWith(".paymently.io") ||
      parsedPaymentUrl.hostname.endsWith(".uddoktapay.com")
    );
    if (!gatewayResponse.ok || gatewayData.status !== true || !parsedPaymentUrl ||
        parsedPaymentUrl.protocol !== "https:" || !trustedPaymentHost) {
      throw new Error(typeof gatewayData.message === "string" ? gatewayData.message : "UddoktaPay did not return a valid payment link.");
    }

    const { error: saveError } = await db
      .from("orders")
      .update({ payment_status: "pending", payment_url: paymentUrl, payment_amount: amount })
      .eq("id", orderId)
      .eq("payment_status", "creating");
    if (saveError) throw new Error("Payment link was created, but the order could not save it. Contact support before retrying.");

    return respond(200, { payment_url: paymentUrl, order_number: order.order_number });
  } catch (error) {
    console.error("UddoktaPay checkout creation failed:", error instanceof Error ? error.message : "Unknown error");
    await db.from("orders").update({ payment_status: "failed" }).eq("id", orderId).eq("payment_status", "creating");
    return respond(502, { error: "Could not create a UddoktaPay payment link. Please try again." });
  }
});
