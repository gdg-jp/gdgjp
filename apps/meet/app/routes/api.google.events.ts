import { verifyPubsubJwt } from "~/features/events/pubsub-jwt.server";
import { handleRawPubsubPushBody } from "~/features/events/push-handler.server";
import type { Route } from "./+types/api.google.events";

export function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}

/**
 * Cloud Pub/Sub Push 通知の受信エンドポイント。
 * 常に Google 署名 OIDC JWT を WebCrypto で検証し、バイパス経路を持たない。
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const env = context.cloudflare.env;
  const verified = await verifyPubsubJwt(request, env);
  if (!verified.ok) {
    return new Response(verified.reason, { status: verified.status });
  }

  const rawBody = await request.text();
  const result = await handleRawPubsubPushBody(env, rawBody);
  return new Response(null, { status: result.status });
}
