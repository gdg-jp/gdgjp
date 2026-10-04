import { type DomainConfig, getConfig } from "./domain-config.js";
import { resolveShortLink } from "./internal-api.js";
import { fetchOrigin, proxyOriginResponse } from "./origin-proxy.js";
import { type GatewayRequest, publicRequestUrl, requestMethod } from "./request.js";
import { validateUpstreamOrigin } from "./upstream.js";

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
  let originResponse: Response;
  try {
    originResponse = await fetchOrigin(request, hostname, upstream);
  } catch {
    return new Response("Bad Gateway", { status: 502 });
  }
  if (originResponse.status !== 404 || (method !== "GET" && method !== "HEAD")) {
    return proxyOriginResponse(request, originResponse);
  }
  const resolved = await resolveShortLink(request, hostname, slug, publicUrl.toString());
  return resolved.status === 204 ? proxyOriginResponse(request, originResponse) : resolved;
}
