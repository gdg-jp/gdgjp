import { createApp } from "./app";
import type { Env } from "./env";
import { callbackPage, completeLink, getLinkedToken } from "./features/auth/accounts";
import { handleDiscordInteraction } from "./features/chat/discord";
import { type GatewayMessage, handleDiscordMessage } from "./features/chat/discord-message";
import { handleChatEvent } from "./features/chat/gchat";
import { fileAnswer } from "./features/filing/filing";
import { type AnswerResult, answerReady } from "./features/inquiry/inquiry";
import { traceInquiry } from "./features/telemetry/langfuse";
import { kvReplayStore, verifyWebhook } from "./features/webhooks/verify";
import { nowSeconds, timingSafeEqual } from "./lib";

export { PendingSweeper } from "./durable/pending-sweeper";

const LANDING = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GDG Japan Agent</title><style>body{font-family:system-ui,sans-serif;margin:2rem;line-height:1.6;max-width:40rem}</style></head><body><h1>GDG Japan Agent</h1><p>Discord の <code>/ask</code> と Google Chat で GDG Japan Wiki に質問できるアシスタントです。回答は質問した場所の権限で作られ、wiki のページを引用します。</p></body></html>`;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(LANDING, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (request.method === "GET" && url.pathname === "/auth/callback") {
      if (url.searchParams.get("error")) return callbackPage(false);
      const app = createApp(env);
      return callbackPage(
        await completeLink(
          url.searchParams.get("code") ?? "",
          url.searchParams.get("state") ?? "",
          app.auth,
        ),
      );
    }
    if (request.method === "POST" && url.pathname === "/api/chat")
      return webhook(request, env, ctx);
    if (request.method === "POST" && url.pathname === "/internal/discord-message")
      return discordMessageRoute(request, env, ctx);
    if (request.method === "POST" && url.pathname === "/internal/answer-ready")
      return answerReadyRoute(request, env);
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/** Verification runs before any application logic; failures never touch the wiki. */
async function webhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const rawBody = await request.text();
  const verified = await verifyWebhook(request, rawBody, {
    discordPublicKey: env.DISCORD_PUBLIC_KEY,
    googleChatAudience: env.GOOGLE_CHAT_AUDIENCE,
    replay: kvReplayStore(env.KV),
  });
  if (!verified.ok) {
    return verified.reason === "replay"
      ? new Response(null, { status: 204 })
      : new Response("Unauthorized", { status: 401 });
  }
  if (verified.platform === "discord" && verified.ping) return Response.json({ type: 1 });
  const app = createApp(env);
  const body = JSON.parse(rawBody);
  return verified.platform === "discord"
    ? handleDiscordInteraction(app, body, ctx)
    : handleChatEvent(app, body, ctx);
}

/**
 * Called by `gdg agent discord-gateway` on the OCI VM for @mentions and DMs. The shared token
 * is checked before the body is read; the listener retries nothing, so a dropped message is
 * simply unanswered.
 */
async function discordMessageRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  if (!env.GATEWAY_TOKEN || !timingSafeEqual(auth, `Bearer ${env.GATEWAY_TOKEN}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const message = (await request.json().catch(() => null)) as GatewayMessage | null;
  if (!message?.id || !message.channel_id)
    return Response.json({ error: "invalid_request" }, { status: 400 });
  // A resumed Gateway session can replay an event; answer each message once.
  if (!(await kvReplayStore(env.KV).claim(`gateway:${message.id}`, 24 * 60 * 60)))
    return new Response(null, { status: 204 });
  const app = createApp(env);
  ctx.waitUntil(
    handleDiscordMessage(app, message, env.DISCORD_BOT_TOKEN).catch((error) =>
      console.error("agent: mention failed", error),
    ),
  );
  return new Response(null, { status: 202 });
}

/** Called by the wiki (service binding) when the runner posts an `answer` result. */
async function answerReadyRoute(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  if (!env.AGENT_SERVICE_TOKEN || !timingSafeEqual(auth, `Bearer ${env.AGENT_SERVICE_TOKEN}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    jobId?: string;
    status?: string;
    result?: AnswerResult;
  } | null;
  if (!body?.jobId || !body.status)
    return Response.json({ error: "invalid_request" }, { status: 400 });
  const app = createApp(env);
  const { delivered, row } = await answerReady(
    body.jobId,
    { status: body.status, result: body.result },
    app.inquiry,
  );
  if (delivered && row) {
    await traceInquiry(env, {
      jobId: row.jobId,
      platform: row.platform,
      chatUserId: row.chatUserId,
      venue: row.venue,
      question: row.question,
      output: body.result?.answer ?? "",
      spaces: row.spaces,
      citedUrls: body.result?.citations.map((c) => c.url) ?? [],
      degraded: row.status === "degraded",
      latencyMs: (nowSeconds() - row.createdAt) * 1000,
    });
    if (row.status === "answered" && row.readerKind === "user" && body.result) {
      const linked = await getLinkedToken(row.platform, row.chatUserId, app.auth);
      await fileAnswer(
        {
          messageId: row.jobId,
          token: linked.status === "ok" ? linked.accessToken : null,
          result: body.result,
        },
        { db: env.DB, wiki: app.wiki },
      ).catch((error) => console.warn("agent: filing failed", error));
    }
  }
  return Response.json({ delivered });
}
