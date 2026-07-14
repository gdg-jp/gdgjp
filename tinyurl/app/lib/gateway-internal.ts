import { getDomainByHostname } from "./domains";
import { gatewaySignaturePayload, verifyGatewayRequest } from "./hmac";
import { handleApexRedirect } from "./redirect-handler";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

async function authenticate(request: Request, env: Env): Promise<string | null> {
  if (!env.GATEWAY_SHARED_SECRET) return null;
  const timestamp = request.headers.get("x-gdg-timestamp") ?? "";
  const signature = request.headers.get("x-gdg-signature") ?? "";
  const signedHostname = request.headers.get("x-gdg-host")?.toLowerCase() ?? "";
  const parsedTimestamp = Number(timestamp);
  if (
    !Number.isInteger(parsedTimestamp) ||
    Math.abs(Math.floor(Date.now() / 1000) - parsedTimestamp) > MAX_CLOCK_SKEW_SECONDS
  ) {
    return null;
  }
  const url = new URL(request.url);
  if (!signedHostname || url.searchParams.get("hostname")?.toLowerCase() !== signedHostname) {
    return null;
  }
  const payload = gatewaySignaturePayload({
    timestamp,
    method: request.method,
    pathname: `${url.pathname}${url.search}`,
    hostname: signedHostname,
  });
  return (await verifyGatewayRequest(env.GATEWAY_SHARED_SECRET, payload, signature))
    ? signedHostname
    : null;
}

export async function handleGatewayInternalRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const hostname = await authenticate(request, env);
  if (!hostname) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const domain = await getDomainByHostname(env.DB, hostname);
  if (!domain || domain.status !== "active") return new Response("Unknown domain", { status: 404 });

  if (url.pathname === "/api/internal/gateway/config") {
    return Response.json(
      { hostname: domain.hostname, mode: domain.mode, upstreamOrigin: domain.upstreamOrigin },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  }

  if (url.pathname !== "/api/internal/gateway/resolve") {
    return new Response("Not Found", { status: 404 });
  }
  const slug = url.searchParams.get("slug") ?? "";
  if (!slug) return new Response(null, { status: 204 });
  const originalUrl = request.headers.get("x-gdg-original-url");
  const publicRequest = new Request(
    originalUrl?.startsWith(`https://${hostname}/`)
      ? originalUrl
      : `https://${hostname}/${encodeURIComponent(slug)}`,
    { method: request.method, headers: request.headers },
  );
  const response = await handleApexRedirect(env, ctx, publicRequest, slug, hostname);
  return response ?? new Response(null, { status: 204 });
}
