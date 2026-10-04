import { type GatewayRequest, requestHeader, requestMethod } from "./request.js";

type RuntimeEnv = {
  TINYURL_INTERNAL_BASE: string;
  GATEWAY_SHARED_SECRET: string;
};
const encoder = new TextEncoder();

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

export async function internalRequest(
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

export async function resolveShortLink(
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
