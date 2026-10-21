const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKeys = (() => {
    try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); }
    catch { return {}; }
  })();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? secretKeys.default ?? Object.values(secretKeys)[0];
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("ORDER_FROM_EMAIL");
  const adminEmail = Deno.env.get("ORDER_NOTIFICATION_EMAIL");
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !fromEmail) {
    return json(500, { error: "Order email service is not configured." });
  }

  let body: { order_id?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON request." });
  }
  if (!body.order_id || !/^[0-9a-f-]{36}$/i.test(body.order_id)) {
    return json(400, { error: "A valid order ID is required." });
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const orderUrl = `${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(body.order_id)}&select=id,order_number,created_at,customer_email,customer_phone,ad_whatsapp,details,email_status`;
  const orderResponse = await fetch(orderUrl, { headers });
  if (!orderResponse.ok) return json(500, { error: "Could not load the saved order." });
  const orders = await orderResponse.json();
  const order = orders[0];
  if (!order) return json(404, { error: "Order not found." });
  if (order.email_status === "sent" || order.email_status === "sending") {
    return json(200, { sent: order.email_status === "sent", message: "Email was already processed." });
  }

  // Claim the email job before sending so repeating this public function call
  // cannot send duplicate messages for the same UUID.
  const claimResponse = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(body.order_id)}&email_status=eq.${order.email_status}&select=id`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ email_status: "sending" }),
  });
  if (!claimResponse.ok) return json(500, { error: "Could not claim the order email." });
  if ((await claimResponse.json()).length === 0) {
    return json(200, { sent: false, message: "Order email is already being processed." });
  }

  const details = order.details ?? {};
  const lines = [
    `Order: ${order.order_number}`,
    `Placed: ${new Date(order.created_at).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })} (Bangladesh time)`,
    `Contact WhatsApp: ${order.customer_phone}`,
    `Message recipient WhatsApp: ${order.ad_whatsapp || "Not provided"}`,
    `Email: ${order.customer_email}`,
    `Campaign goal: ${details.goalLabel || details.goal || "Not provided"}`,
    `Post link: ${details.postLink || "Not provided"}`,
    `Country: ${details.country || "Not provided"}`,
    `Duration: ${details.days ?? "Not provided"} days`,
    `Daily budget: $${details.dailyBudgetUsd ?? "Not provided"}`,
    `Estimated total: ${details.totalBudgetBdt ?? "Not provided"} BDT`,
    "",
    "We have received your order. Our team will contact you about the next steps.",
  ];

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [order.customer_email],
      ...(adminEmail ? { bcc: [adminEmail] } : {}),
      subject: `SMMCaptain order received — ${order.order_number}`,
      text: lines.join("\n"),
    }),
  });

  if (!emailResponse.ok) {
    await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(body.order_id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ email_status: "failed" }),
    });
    return json(502, { error: "Order was saved, but the confirmation email could not be sent." });
  }

  await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(body.order_id)}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ email_status: "sent" }),
  });
  return json(200, { sent: true, order_number: order.order_number });
});
