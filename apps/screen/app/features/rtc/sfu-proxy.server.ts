/**
 * Forwards the browser's Cloudflare Realtime SFU calls with the app secret.
 * The browser addresses `/rtc/<stageId>/<sfu path>`; only the handful of
 * session/track operations a page needs are let through.
 */

export const SFU_BASE = "https://rtc.live.cloudflare.com/v1";

const ALLOWED: Array<{ method: string; path: RegExp }> = [
  { method: "POST", path: /^sessions\/new$/ },
  { method: "POST", path: /^sessions\/[A-Za-z0-9_-]{1,128}\/tracks\/new$/ },
  { method: "PUT", path: /^sessions\/[A-Za-z0-9_-]{1,128}\/tracks\/close$/ },
  { method: "PUT", path: /^sessions\/[A-Za-z0-9_-]{1,128}\/renegotiate$/ },
  { method: "GET", path: /^sessions\/[A-Za-z0-9_-]{1,128}$/ },
];

export function isAllowedSfuCall(method: string, path: string): boolean {
  return ALLOWED.some((rule) => rule.method === method && rule.path.test(path));
}

export async function forwardToSfu(
  env: Pick<Env, "REALTIME_APP_ID" | "REALTIME_APP_TOKEN">,
  request: Request,
  path: string,
): Promise<Response> {
  if (!isAllowedSfuCall(request.method, path)) {
    return new Response("not allowed", { status: 405 });
  }
  if (!env.REALTIME_APP_ID || !env.REALTIME_APP_TOKEN) {
    return Response.json({ errorCode: "sfu_not_configured" }, { status: 503 });
  }
  const body = request.method === "GET" ? undefined : await request.text();
  const upstream = await fetch(`${SFU_BASE}/apps/${env.REALTIME_APP_ID}/${path}`, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${env.REALTIME_APP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body || undefined,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
