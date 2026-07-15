import { getCache } from "@vercel/functions";

type DomainConfig = {
  hostname: string;
  mode: "short-only" | "origin-first";
  upstreamOrigin: string | null;
};

type RuntimeEnv = {
  TINYURL_INTERNAL_BASE: string;
  GATEWAY_SHARED_SECRET: string;
};

type GatewayRequest = {
  url: string;
  method?: string;
  headers: Headers | Record<string, unknown>;
  body?: unknown;
};

const CONFIG_TTL_MS = 30_000;
const CONFIG_CACHE_LIMIT = 200;
const DNS_TTL_MS = 5 * 60_000;
const SHARED_CONFIG_TTL_SECONDS = 7 * 24 * 60 * 60;
const SHARED_DNS_TTL_SECONDS = 60 * 60;
const ORIGIN_TIMEOUT_MS = 8_000;
const DNS_QUERY_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const VERCEL_CDN_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=86400";
const CACHEABLE_ORIGIN_STATUSES = new Set([200, 301, 302, 307, 308]);
const configCache = new Map<string, { config: DomainConfig; expiresAt: number }>();
const dnsCache = new Map<string, { safe: boolean; expiresAt: number }>();
const runtimeCache = getCache({ namespace: "tinyurl-gateway" });
const sharedCacheKeysForTests = new Set<string>();
const encoder = new TextEncoder();
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

export function clearLocalCachesForTests(): void {
  configCache.clear();
  dnsCache.clear();
}

export async function clearConfigCacheForTests(): Promise<void> {
  clearLocalCachesForTests();
  await Promise.all([...sharedCacheKeysForTests].map((key) => runtimeCache.delete(key)));
  sharedCacheKeysForTests.clear();
}

export const config = { runtime: "edge", regions: ["hnd1"] };

function runtimeCacheFailure(operation: "get" | "set", key: string, error: unknown): void {
  console.warn(
    JSON.stringify({
      event: "runtime_cache_failure",
      operation,
      keyType: key.split(":", 1)[0],
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

function requestMethod(request: GatewayRequest): string {
  return (request.method ?? "GET").toUpperCase();
}

function headerValue(value: unknown): string | null {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function requestHeader(request: GatewayRequest, name: string): string | null {
  if (typeof (request.headers as Headers).get === "function") {
    return (request.headers as Headers).get(name);
  }
  const entry = Object.entries(request.headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return headerValue(entry?.[1]);
}

function requestHeaderEntries(request: GatewayRequest): Array<[string, string]> {
  if (typeof (request.headers as Headers).entries === "function") {
    return [...(request.headers as Headers).entries()];
  }
  return Object.entries(request.headers).flatMap(([name, value]) => {
    const normalized = headerValue(value);
    return normalized === null ? [] : [[name, normalized]];
  });
}

function requestBody(request: GatewayRequest): BodyInit | undefined {
  const body = request.body;
  if (body === null || body === undefined) return undefined;
  if (
    typeof body === "string" ||
    body instanceof ArrayBuffer ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ReadableStream
  ) {
    return body;
  }
  if (ArrayBuffer.isView(body)) {
    const copy = new Uint8Array(body.byteLength);
    copy.set(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    return copy.buffer;
  }
  return JSON.stringify(body);
}

function runtimeEnv(): RuntimeEnv {
  const TINYURL_INTERNAL_BASE = process.env.TINYURL_INTERNAL_BASE ?? "https://url.gdgs.jp";
  const GATEWAY_SHARED_SECRET = process.env.GATEWAY_SHARED_SECRET ?? "";
  if (!GATEWAY_SHARED_SECRET) throw new Error("GATEWAY_SHARED_SECRET is not configured");
  return { TINYURL_INTERNAL_BASE, GATEWAY_SHARED_SECRET };
}

function signaturePayload(timestamp: string, method: string, pathname: string, hostname: string) {
  return `${timestamp}\n${method.toUpperCase()}\n${pathname}\n${hostname.toLowerCase()}`;
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function internalRequest(
  path: "/api/internal/gateway/config" | "/api/internal/gateway/resolve",
  hostname: string,
  search: URLSearchParams,
  originalRequest?: GatewayRequest,
  originalUrl?: string,
): Promise<Response> {
  const env = runtimeEnv();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const method = originalRequest && requestMethod(originalRequest) === "HEAD" ? "HEAD" : "GET";
  search.set("hostname", hostname);
  const url = new URL(path, env.TINYURL_INTERNAL_BASE);
  url.search = search.toString();
  const headers = new Headers({
    "x-gdg-timestamp": timestamp,
    "x-gdg-host": hostname,
    "x-gdg-signature": await sign(
      env.GATEWAY_SHARED_SECRET,
      signaturePayload(timestamp, method, `${url.pathname}${url.search}`, hostname),
    ),
  });
  if (originalRequest) {
    headers.set("x-gdg-original-url", originalUrl ?? originalRequest.url);
    const userAgent = requestHeader(originalRequest, "user-agent");
    if (userAgent) headers.set("user-agent", userAgent);
    const referer = requestHeader(originalRequest, "referer");
    if (referer) headers.set("referer", referer);
  }
  return fetch(url, { method, headers, redirect: "manual" });
}

async function getConfig(hostname: string): Promise<DomainConfig | null> {
  const cached = configCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.config;
  const sharedKey = `config:${hostname}`;
  sharedCacheKeysForTests.add(sharedKey);
  const shared = await runtimeCache.get(sharedKey).catch((error) => {
    runtimeCacheFailure("get", sharedKey, error);
    return null;
  });
  if (
    shared &&
    typeof shared === "object" &&
    "hostname" in shared &&
    typeof shared.hostname === "string" &&
    shared.hostname.toLowerCase() === hostname &&
    "mode" in shared &&
    (shared.mode === "short-only" || shared.mode === "origin-first") &&
    "upstreamOrigin" in shared &&
    (typeof shared.upstreamOrigin === "string" || shared.upstreamOrigin === null)
  ) {
    const config = shared as DomainConfig;
    configCache.set(hostname, { config, expiresAt: Date.now() + CONFIG_TTL_MS });
    return config;
  }
  const response = await internalRequest(
    "/api/internal/gateway/config",
    hostname,
    new URLSearchParams(),
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Config service returned ${response.status}`);
  const config = (await response.json()) as DomainConfig;
  if (config.hostname.toLowerCase() !== hostname) throw new Error("Config hostname mismatch");
  if (configCache.size >= CONFIG_CACHE_LIMIT)
    configCache.delete(configCache.keys().next().value ?? "");
  configCache.set(hostname, { config, expiresAt: Date.now() + CONFIG_TTL_MS });
  await runtimeCache
    .set(sharedKey, config, {
      ttl: SHARED_CONFIG_TTL_SECONDS,
      tags: [`domain-${hostname}`],
    })
    .catch((error) => runtimeCacheFailure("set", sharedKey, error));
  return config;
}

function isIpv4(ip: string): boolean {
  const parts = ip.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIpLiteral(hostname: string): boolean {
  return isIpv4(hostname) || hostname.includes(":");
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

type DnsJsonResponse = {
  Status?: number;
  Answer?: Array<{ data?: string; type?: number; TTL?: number }>;
};

async function queryAddresses(hostname: string, type: "A" | "AAAA"): Promise<string[]> {
  const query = new URL(DNS_QUERY_ENDPOINT);
  query.searchParams.set("name", hostname);
  query.searchParams.set("type", type);
  const response = await fetch(query, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error("DNS lookup failed");
  const data = (await response.json()) as DnsJsonResponse;
  if (typeof data.Status === "number" && data.Status !== 0 && data.Status !== 3) {
    throw new Error("DNS lookup failed");
  }
  const expectedType = type === "A" ? 1 : 28;
  return (data.Answer ?? []).flatMap((answer) =>
    answer.type === expectedType && answer.data ? [answer.data.trim()] : [],
  );
}

async function resolvesOnlyToPublicAddresses(hostname: string): Promise<boolean> {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.safe;
  const sharedKey = `dns:${hostname}`;
  sharedCacheKeysForTests.add(sharedKey);
  const shared = await runtimeCache.get(sharedKey).catch((error) => {
    runtimeCacheFailure("get", sharedKey, error);
    return null;
  });
  if (typeof shared === "boolean") {
    dnsCache.set(hostname, { safe: shared, expiresAt: Date.now() + DNS_TTL_MS });
    return shared;
  }
  const [ipv4, ipv6] = await Promise.all([
    queryAddresses(hostname, "A"),
    queryAddresses(hostname, "AAAA"),
  ]);
  const safe =
    ipv4.length + ipv6.length > 0 &&
    ipv4.every((address) => isIpv4(address) && !isPrivateIpv4(address)) &&
    ipv6.every((address) => address.includes(":") && !isPrivateIpv6(address));
  if (dnsCache.size >= CONFIG_CACHE_LIMIT) dnsCache.delete(dnsCache.keys().next().value ?? "");
  dnsCache.set(hostname, { safe, expiresAt: Date.now() + DNS_TTL_MS });
  await runtimeCache
    .set(sharedKey, safe, {
      ttl: SHARED_DNS_TTL_SECONDS,
      tags: [`domain-${hostname.replace(/^origin\./, "")}`],
    })
    .catch((error) => runtimeCacheFailure("set", sharedKey, error));
  return safe;
}

export async function validateUpstreamOrigin(origin: string, publicHostname: string): Promise<URL> {
  const url = new URL(origin);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    isIpLiteral(hostname) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === publicHostname ||
    hostname === "gdgs.jp" ||
    hostname.endsWith(".gdgs.jp") ||
    hostname === "vercel.app" ||
    hostname.endsWith(".vercel.app")
  ) {
    throw new Error("Unsafe upstream origin");
  }
  if (!(await resolvesOnlyToPublicAddresses(hostname))) {
    throw new Error("Upstream resolves to a private address");
  }
  return url;
}

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

function proxyOriginResponse(request: GatewayRequest, response: Response): Response {
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

async function resolveShortLink(
  request: GatewayRequest,
  hostname: string,
  slug: string,
  originalUrl: string,
): Promise<Response> {
  return internalRequest(
    "/api/internal/gateway/resolve",
    hostname,
    new URLSearchParams({ slug }),
    request,
    originalUrl,
  );
}

function publicRequestUrl(request: GatewayRequest): URL | null {
  try {
    const absolute = new URL(request.url);
    if (absolute.protocol === "http:" || absolute.protocol === "https:") return absolute;
  } catch {
    // Some local and compatibility adapters pass only the request target (for example `/`).
  }

  const forwardedHost = requestHeader(request, "x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeader(request, "host")?.trim();
  if (!host || !request.url.startsWith("/") || request.url.startsWith("//")) return null;
  try {
    return new URL(request.url, `https://${host}`);
  } catch {
    return null;
  }
}

export async function handleGatewayRequest(request: GatewayRequest): Promise<Response> {
  const publicUrl = publicRequestUrl(request);
  if (!publicUrl) return new Response("Invalid Request URL", { status: 400 });
  const hostname = publicUrl.hostname.toLowerCase();
  const method = requestMethod(request);
  let config: DomainConfig | null;
  try {
    config = await getConfig(hostname);
  } catch {
    return new Response("Gateway configuration unavailable", { status: 502 });
  }
  if (!config) return new Response("Misdirected Request", { status: 421 });

  const slug = publicUrl.pathname.slice(1).split("/")[0] ?? "";
  if (config.mode === "short-only") {
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const resolved = await resolveShortLink(request, hostname, slug, publicUrl.toString());
    return resolved.status === 204 ? new Response("Not Found", { status: 404 }) : resolved;
  }
  if (!config.upstreamOrigin) return new Response("Invalid domain configuration", { status: 502 });

  let upstream: URL;
  try {
    upstream = await validateUpstreamOrigin(config.upstreamOrigin, hostname);
  } catch {
    return new Response("Unsafe upstream configuration", { status: 502 });
  }
  upstream.pathname = publicUrl.pathname;
  upstream.search = publicUrl.search;
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
  } catch {
    return new Response("Bad Gateway", { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
  if (originResponse.status !== 404 || (method !== "GET" && method !== "HEAD")) {
    return proxyOriginResponse(request, originResponse);
  }
  const resolved = await resolveShortLink(request, hostname, slug, publicUrl.toString());
  return resolved.status === 204 ? proxyOriginResponse(request, originResponse) : resolved;
}

export default function gateway(request: Request): Promise<Response> {
  return handleGatewayRequest(request);
}
