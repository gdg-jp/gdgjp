import {
  type GatewayRequest,
  requestBody,
  requestHeader,
  requestHeaderEntries,
  requestMethod,
} from "./request.js";

const ORIGIN_TIMEOUT_MS = 8_000;
const VERCEL_CDN_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=86400";
const CACHEABLE_ORIGIN_STATUSES = new Set([200, 301, 302, 307, 308]);
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);
function forwardedHeaders(request: GatewayRequest, hostname: string): Headers {
  const headers = new Headers();
  for (const [name, value] of requestHeaderEntries(request)) {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && !name.toLowerCase().startsWith("x-gdg-")) {
      headers.set(name, value);
    }
  }
  // Request an uncompressed representation so the proxy never forwards a stale encoding label.
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-host", hostname);
  headers.set("x-forwarded-proto", "https");
  return headers;
}

function isPubliclyCacheable(request: GatewayRequest, response: Response): boolean {
  const method = requestMethod(request);
  if (method !== "GET" && method !== "HEAD") return false;
  if (!CACHEABLE_ORIGIN_STATUSES.has(response.status)) return false;
  if (requestHeader(request, "authorization") || requestHeader(request, "cookie")) return false;
  if (response.headers.has("set-cookie")) return false;

  const vary = response.headers.get("vary");
  if (vary?.split(",").some((value) => value.trim() === "*")) return false;

  const directives = new Set(
    (response.headers.get("cache-control") ?? "")
      .split(",")
      .map((value) => value.trim().split("=", 1)[0]?.toLowerCase())
      .filter(Boolean),
  );
  return (
    directives.has("public") &&
    !directives.has("private") &&
    !directives.has("no-cache") &&
    !directives.has("no-store")
  );
}

export function proxyOriginResponse(request: GatewayRequest, response: Response): Response {
  const headers = new Headers(response.headers);
  // Fetch exposes a decoded body, so wire-representation headers would make the client decode the
  // body a second time or trust a stale byte count.
  headers.delete("content-encoding");
  headers.delete("content-length");
  if (isPubliclyCacheable(request, response)) {
    // Keep the origin's browser policy intact while caching only at Vercel's CDN.
    headers.set("Vercel-CDN-Cache-Control", VERCEL_CDN_CACHE_CONTROL);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function fetchOrigin(
  request: GatewayRequest,
  hostname: string,
  upstream: URL,
): Promise<Response> {
  const method = requestMethod(request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ORIGIN_TIMEOUT_MS);
  let originResponse: Response;
  try {
    const body = method === "GET" || method === "HEAD" ? undefined : requestBody(request);
    originResponse = await fetch(upstream, {
      method,
      headers: forwardedHeaders(request, hostname),
      body,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  return originResponse;
}
