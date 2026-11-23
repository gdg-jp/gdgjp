import { processPubsubEnvelope } from "~/features/events/push-handler.server";
import type { Route } from "./+types/dev.simulate-event";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isDevSimulationEnabled(env: Env, request: Request): boolean {
  return (
    env.ENVIRONMENT !== "production" && isLoopbackUrl(env.APP_URL) && isLoopbackUrl(request.url)
  );
}

export function loader({ request, context }: Route.LoaderArgs) {
  if (!isDevSimulationEnabled(context.cloudflare.env, request)) {
    return new Response("Not Found", { status: 404 });
  }
  return new Response("Method Not Allowed", { status: 405 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  if (!isDevSimulationEnabled(env, request)) {
    return new Response("Not Found", { status: 404 });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let envelope: unknown;
  try {
    envelope = await request.json();
  } catch {
    return Response.json({ ok: false, error: "JSON のパースに失敗しました" }, { status: 400 });
  }

  const result = await processPubsubEnvelope(env, envelope);
  return Response.json(
    { ok: result.status === 204, action: result.action },
    { status: result.status === 204 ? 200 : 500 },
  );
}
