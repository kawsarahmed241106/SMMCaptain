const allowedOrigins = new Set([
  "https://smmcaptain.xyz",
  "https://www.smmcaptain.xyz",
  "https://kawsarahmed241106.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);

const requestCounts = new Map<string, { count: number; resetsAt: number }>();

function isFacebookHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch";
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function respond(status: number, payload: Record<string, unknown>, origin: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function extractIframeUrl(html: string) {
  const match = html.match(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/i);
  if (!match) return "";
  return decodeHtmlAttribute(match[1]);
}

function isFacebookEmbedUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isFacebookHost(url.hostname) && url.pathname.startsWith("/plugins/video.php");
  } catch {
    return false;
  }
}

function extractCanonicalUrl(html: string) {
  const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    ?? html.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  if (canonical) return decodeHtmlAttribute(canonical[1]);

  const openGraph = html.match(/<meta\b[^>]*(?:property|name)=["']og:url["'][^>]*content=["']([^"']+)["']/i)
    ?? html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:url["']/i);
  return openGraph ? decodeHtmlAttribute(openGraph[1]) : "";
}

function isDirectVideoPermalink(url: URL) {
  if (/\/(?:videos?|watch|reel|reels)\//i.test(url.pathname)) return true;
  return url.pathname.toLowerCase() === "/watch/" && Boolean(url.searchParams.get("v"));
}

function readRateLimit(ip: string) {
  const now = Date.now();
  if (requestCounts.size > 2_000) {
    for (const [key, value] of requestCounts) {
      if (value.resetsAt <= now) requestCounts.delete(key);
    }
  }
  const current = requestCounts.get(ip);
  if (!current || current.resetsAt <= now) {
    requestCounts.set(ip, { count: 1, resetsAt: now + 60_000 });
    return true;
  }
  if (current.count >= 12) return false;
  current.count += 1;
  return true;
}

async function readLimitedBody(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigins.has(origin)) return new Response("Origin not allowed.", { status: 403 });
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return respond(405, { error: "POST is required." }, origin);

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!readRateLimit(forwardedFor)) return respond(429, { error: "Too many preview requests. Please wait a minute." }, origin);

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "Invalid request body." }, origin);
  }

  let inputUrl: URL;
  try {
    inputUrl = new URL(typeof body.url === "string" ? body.url : "");
  } catch {
    return respond(400, { error: "Enter a valid Facebook share link." }, origin);
  }
  if (inputUrl.protocol !== "https:" || !isFacebookHost(inputUrl.hostname) ||
      !/^\/share\/(?:v|r)\/[\w-]+\/?$/i.test(inputUrl.pathname)) {
    return respond(400, { error: "Only Facebook video or reel share links can be resolved." }, origin);
  }

  try {
    // Meta's tokenless oEmbed API supports public Facebook video URLs, including
    // share URLs. Asking for iframe HTML gives us a safe URL to put in the preview.
    const oembedUrl = new URL("https://graph.facebook.com/v26.0/oembed_video");
    oembedUrl.searchParams.set("url", inputUrl.href);
    oembedUrl.searchParams.set("maxwidth", "500");
    oembedUrl.searchParams.set("useiframe", "true");
    const oembedResponse = await fetch(oembedUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (oembedResponse.ok) {
      const oembed = await oembedResponse.json().catch(() => null);
      const embedUrl = typeof oembed?.html === "string" ? extractIframeUrl(oembed.html) : "";
      if (embedUrl && isFacebookEmbedUrl(embedUrl)) {
        return respond(200, { embed_url: embedUrl }, origin);
      }
    }

    // Fall back to resolving redirects for URLs Meta's oEmbed endpoint does not
    // accept. Some share links may still resolve to a canonical public permalink.
    let currentUrl = inputUrl;
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(8_000),
      });

      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location || redirects === 5) break;
      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.protocol !== "https:" || !isFacebookHost(nextUrl.hostname)) {
        return respond(422, { error: "Facebook redirected this share link outside its video pages." }, origin);
      }
      currentUrl = nextUrl;
    }

    if (!response || !response.ok) {
      return respond(422, { error: "Facebook did not resolve this share link to a public video." }, origin);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      return respond(422, { error: "Facebook did not return a video page for this share link." }, origin);
    }

    const html = await readLimitedBody(response, 1_000_000);
    const candidates = [response.url, extractCanonicalUrl(html)];
    for (const candidate of candidates) {
      if (!candidate) continue;
      let resolved: URL;
      try { resolved = new URL(candidate, currentUrl); } catch { continue; }
      resolved.protocol = "https:";
      if (isFacebookHost(resolved.hostname) && !/\/share\/(?:v|r)\//i.test(resolved.pathname) && isDirectVideoPermalink(resolved)) {
        return respond(200, { resolved_url: resolved.href }, origin);
      }
    }

    return respond(422, {
      error: "Facebook did not expose a public video permalink. Confirm the video is public and try its direct video link.",
    }, origin);
  } catch (error) {
    console.error("Facebook share link resolution failed:", error instanceof Error ? error.message : "Unknown error");
    return respond(502, { error: "Facebook could not resolve this share link right now." }, origin);
  }
});
