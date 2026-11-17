// Recipe page proxy: a free Cloudflare Worker that fetches a recipe page
// for the app, since browsers can't read other sites directly (CORS).
//
// Setup (about 5 minutes, free plan is plenty):
//   1. Sign in at https://dash.cloudflare.com → Workers & Pages → Create →
//      "Create Worker". Name it e.g. "recipe-proxy" and click Deploy.
//   2. Click "Edit code", replace everything with this file, click Deploy.
//   3. Copy the worker URL (https://recipe-proxy.<you>.workers.dev) and set
//      corsProxy in config.js to:
//        "https://recipe-proxy.<you>.workers.dev/?url={url}"
//
// Only pages requested from ALLOWED_ORIGINS are served, so other websites
// can't use your worker as a free proxy.

const ALLOWED_ORIGINS = [
  "https://vashtag.github.io",
  "http://localhost",
  "http://127.0.0.1",
];

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function originAllowed(origin) {
  return !!origin && ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o + ":"));
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": originAllowed(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });
    if (!originAllowed(origin)) return new Response("Origin not allowed", { status: 403, headers: cors });

    const target = new URL(request.url).searchParams.get("url") || "";
    if (!/^https?:\/\//i.test(target)) {
      return new Response("Pass the page as ?url=https://...", { status: 400, headers: cors });
    }

    let res;
    try {
      res = await fetch(target, { headers: BROWSER_HEADERS, redirect: "follow" });
    } catch (e) {
      return new Response(`Could not reach the site: ${e.message}`, { status: 502, headers: cors });
    }

    const type = res.headers.get("Content-Type") || "text/html; charset=utf-8";
    if (!/html|xml|text/i.test(type)) {
      return new Response("Not a web page", { status: 415, headers: cors });
    }
    return new Response(await res.text(), {
      status: res.status,
      headers: { ...cors, "Content-Type": type, "Cache-Control": "public, max-age=3600" },
    });
  },
};
