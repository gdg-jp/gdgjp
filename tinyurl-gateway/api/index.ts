import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";

type DomainConfig = {
  hostname: string;
  mode: "short-only" | "origin-first";
  upstreamOrigin: string | null;
};

type RuntimeEnv = {
  TINYURL_INTERNAL_BASE: string;
  GATEWAY_SHARED_SECRET: string;
};

const CONFIG_TTL_MS = 30_000;
const CONFIG_CACHE_LIMIT = 200;
const ORIGIN_TIMEOUT_MS = 8_000;
const configCache = new Map<string, { config: DomainConfig; expiresAt: number }>();
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

export function clearConfigCacheForTests(): void {
  configCache.clear();
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
  originalRequest?: Request,
): Promise<Response> {
  const env = runtimeEnv();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const method = originalRequest?.method === "HEAD" ? "HEAD" : "GET";
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
    headers.set("x-gdg-original-url", originalRequest.url);
    const userAgent = originalRequest.headers.get("user-agent");
    if (userAgent) headers.set("user-agent", userAgent);
    const referer = originalRequest.headers.get("referer");
    if (referer) headers.set("referer", referer);
  }
  return fetch(url, { method, headers });
}

async function getConfig(hostname: string): Promise<DomainConfig | null> {
  const cached = configCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.config;
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
  return config;
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
  const normalized = ip.toLowerCase();
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

export async function validateUpstreamOrigin(origin: string, publicHostname: string): Promise<URL> {
  const url = new URL(origin);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    isIP(hostname) !== 0 ||
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
  const [ipv4, ipv6] = await Promise.all([
    resolve4(hostname).catch(() => []),
    resolve6(hostname).catch(() => []),
  ]);
  if (ipv4.length + ipv6.length === 0) throw new Error("Upstream hostname did not resolve");
  if (ipv4.some(isPrivateIpv4) || ipv6.some(isPrivateIpv6)) {
    throw new Error("Upstream resolves to a private address");
  }
  return url;
}

function forwardedHeaders(request: Request, hostname: string): Headers {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && !name.toLowerCase().startsWith("x-gdg-")) {
      headers.set(name, value);
    }
  }
  headers.set("x-forwarded-host", hostname);
  headers.set("x-forwarded-proto", "https");
  return headers;
}

async function resolveShortLink(
  request: Request,
  hostname: string,
  slug: string,
): Promise<Response> {
  return internalRequest(
    "/api/internal/gateway/resolve",
    hostname,
    new URLSearchParams({ slug }),
    request,
  );
}

function publicRequestUrl(request: Request): URL | null {
  try {
    const absolute = new URL(request.url);
    if (absolute.protocol === "http:" || absolute.protocol === "https:") return absolute;
  } catch {
    // Vercel's Node runtime can pass only the request target (for example `/`).
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  if (!host || !request.url.startsWith("/") || request.url.startsWith("//")) return null;
  try {
    return new URL(request.url, `https://${host}`);
  } catch {
    return null;
  }
}

export async function handleGatewayRequest(request: Request): Promise<Response> {
  const publicUrl = publicRequestUrl(request);
  if (!publicUrl) return new Response("Invalid Request URL", { status: 400 });
  const hostname = publicUrl.hostname.toLowerCase();
  let config: DomainConfig | null;
  try {
    config = await getConfig(hostname);
  } catch {
    return new Response("Gateway configuration unavailable", { status: 502 });
  }
  if (!config) return new Response("Misdirected Request", { status: 421 });

  const slug = publicUrl.pathname.slice(1).split("/")[0] ?? "";
  if (config.mode === "short-only") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const resolved = await resolveShortLink(request, hostname, slug);
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
    originResponse = await fetch(upstream, {
      method: request.method,
      headers: forwardedHeaders(request, hostname),
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
      signal: controller.signal,
      duplex: request.body ? "half" : undefined,
    } as RequestInit & { duplex?: "half" });
  } catch {
    return new Response("Bad Gateway", { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
  if (originResponse.status !== 404 || (request.method !== "GET" && request.method !== "HEAD")) {
    return originResponse;
  }
  const resolved = await resolveShortLink(request, hostname, slug);
  return resolved.status === 204 ? originResponse : resolved;
}

export default handleGatewayRequest;
