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
  const apiKey = Deno.env.get("UDDOKTAPAY_API_KEY")?.trim() ?? "";
  const billingEmail = Deno.env.get("UDDOKTAPAY_BILLING_EMAIL")?.trim().toLowerCase() ?? "";
  if (!supabaseUrl || !serviceRoleKey || !apiKey || !billingEmail) {
    console.error("Supabase or UddoktaPay function secrets are missing.");
    return respond(503, { error: "Payment service is not configured yet." });
  }

  let body: { checkout_id?: string; checkout_token?: string };
  let publicFailure = "Could not create a UddoktaPay payment link. Please try again.";
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "Invalid request body." });
  }

  const checkoutId = typeof body.checkout_id === "string" ? body.checkout_id : "";
  const checkoutToken = typeof body.checkout_token === "string" ? body.checkout_token : "";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(checkoutId)) return respond(400, { error: "Invalid checkout reference." });
  if (!uuidPattern.test(checkoutToken)) return respond(400, { error: "Invalid payment token." });
  if (billingEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) {
    console.error("UDDOKTAPAY_BILLING_EMAIL is not a valid email address.");
    return respond(503, { error: "Payment service is not configured yet." });
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: intent, error: intentError } = await db
    .from("order_payment_intents")
    .select("id, checkout_token, details, payment_status, payment_url, payment_amount, expires_at, created_order_id")
    .eq("id", checkoutId)
    .eq("checkout_token", checkoutToken)
    .maybeSingle();
  if (intentError) {
    console.error("Could not read checkout intent:", intentError.message);
    return respond(500, { error: "Could not prepare payment. Please try again." });
  }
  if (!intent) return respond(404, { error: "Payment session not found. Submit the form again." });
  if (intent.created_order_id || intent.payment_status === "paid") {
    return respond(409, { error: "Payment is already complete and the order has been submitted." });
  }
  if (new Date(intent.expires_at).getTime() <= Date.now()) {
    return respond(410, { error: "This payment session expired. Please submit the form again." });
  }
  if (intent.payment_status === "pending" && intent.payment_url) {
    return respond(200, { payment_url: intent.payment_url, checkout_id: intent.id });
  }
  if (intent.payment_status === "creating") {
    return respond(409, { error: "A payment link is already being prepared. Please wait a moment." });
  }

  const details = intent.details as Record<string, unknown>;
  const dailyBudget = Number(details.dailyBudgetUsd);
  const days = Number(details.days);
  const dollarRate = Number(details.dollarRate);
  const amount = Number(intent.payment_amount);
  if (!Number.isFinite(dailyBudget) || dailyBudget < 2 || dailyBudget > 1000 ||
      !Number.isInteger(days) || days < 1 || days > 365 || dailyBudget * days < 10 ||
      !Number.isFinite(dollarRate) || dollarRate < 1 ||
      !Number.isFinite(amount) || amount !== Math.round(dailyBudget * days * dollarRate * 100) / 100) {
    return respond(400, { error: "The saved payment amount is invalid. Please submit the form again." });
  }

  const { data: claimedIntent, error: claimError } = await db
    .from("order_payment_intents")
    .update({ payment_status: "creating", payment_attempted_at: new Date().toISOString() })
    .eq("id", checkoutId)
    .in("payment_status", ["unpaid", "failed", "cancelled"])
    .select("id")
    .maybeSingle();
  if (claimError) {
    console.error("Could not reserve checkout intent:", claimError.message);
    return respond(500, { error: "Could not start payment. Please try again." });
  }
  if (!claimedIntent) return respond(409, { error: "A payment attempt is already in progress. Refresh and try again." });

  const resultUrl = `https://smmcaptain.xyz/payment-result.html?checkout_id=${encodeURIComponent(checkoutId)}&checkout_token=${encodeURIComponent(checkoutToken)}`;
  const checkoutPayload = {
    full_name: "SMMCaptain Customer",
    email: billingEmail,
    amount: amount.toFixed(2),
    metadata: { checkout_id: intent.id, order_id: intent.id },
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
      const gatewayMessage = typeof gatewayData.message === "string" ? gatewayData.message.trim() : "";
      publicFailure = gatewayMessage
        ? `UddoktaPay rejected checkout: ${gatewayMessage.slice(0, 240)}`
        : `UddoktaPay did not return a valid payment link (HTTP ${gatewayResponse.status}).`;
      throw new Error(publicFailure);
    }

    const { error: saveError } = await db
      .from("order_payment_intents")
      .update({ payment_status: "pending", payment_url: paymentUrl })
      .eq("id", checkoutId)
      .eq("payment_status", "creating");
    if (saveError) throw new Error("Payment link was created, but the payment session could not be saved. Contact support before retrying.");

    return respond(200, { payment_url: paymentUrl, checkout_id: intent.id });
  } catch (error) {
    console.error("UddoktaPay checkout creation failed:", error instanceof Error ? error.message : "Unknown error");
    await db.from("order_payment_intents").update({ payment_status: "failed" }).eq("id", checkoutId).eq("payment_status", "creating");
    return respond(502, { error: publicFailure });
  }
});
