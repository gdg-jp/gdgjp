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

/**
 * `wrangler types` は ENVIRONMENT を `[vars]` のリテラル "production" として型付けするため、
 * ほかのアプリと同じく "production" との比較にし、APP_URL とリクエストの両方が loopback であることを必須にする。
 */
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

/**
 * ローカル開発専用の Pub/Sub 通知シミュレータ。
 * ENVIRONMENT が "production" ではなく、かつ loopback のときのみ有効で、それ以外では 404 を返す。
 * `/api/google/events` 自体に JWT バイパスを入れず、内部ハンドラ `processPubsubEnvelope` を直接呼ぶ。
 */
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
