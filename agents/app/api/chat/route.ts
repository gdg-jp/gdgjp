import { after } from "next/server";

import { getAgentsChat } from "@/lib/adapters";
import { registerAgentHandlers } from "@/lib/agent";
import { getReplayStore } from "@/lib/redis";
import { type ReplayStore, verifyWebhook } from "@/lib/verify";

export const runtime = "nodejs";

function verifyEnv() {
  return {
    GOOGLE_CHAT_AUDIENCE: process.env.GOOGLE_CHAT_AUDIENCE ?? "",
    DISCORD_PUBLIC_KEY: process.env.DISCORD_PUBLIC_KEY ?? "",
  };
}

/** Replay store that connects to Redis only when verification reaches replay checks. */
function lazyReplayStore(): ReplayStore {
  return {
    seen(id) {
      return getReplayStore().seen(id);
    },
    remember(id, ttlSeconds) {
      return getReplayStore().remember(id, ttlSeconds);
    },
  };
}

/**
 * Chat SDK webhook entry point for Google Chat and Discord.
 *
 * Verification runs before any adapter dispatch. A failed check returns 401 and
 * never reaches Redis application state or Wiki tools.
 */
export async function POST(request: Request): Promise<Response> {
  // Read the raw body once — Discord Ed25519 covers these exact bytes.
  const rawBody = await request.text();

  // Regular Discord messages arrive through the Gateway, not the Interactions
  // HTTP endpoint. The Gateway listener forwards them here with the bot token;
  // the Discord adapter validates that token before it dispatches the event.
  // Do not pass these through verifyWebhook: they are intentionally not signed
  // by Discord's HTTP-interaction Ed25519 key.
  if (request.headers.has("x-discord-gateway-token")) {
    const bot = getAgentsChat("discord");
    registerAgentHandlers(bot);
    return bot.webhooks.discord(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: rawBody,
      }),
      {
        waitUntil: (task: Promise<unknown>) => {
          after(() => task);
        },
      },
    );
  }

  const result = await verifyWebhook(request, rawBody, {
    env: verifyEnv(),
    replay: lazyReplayStore(),
  });

  if (!result.ok) {
    // Replays are dropped without a second downstream call; acknowledge so
    // platforms do not retry forever. All other failures are 401.
    if (result.reason === "replay") {
      return new Response(null, { status: 204 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  if (result.platform === "discord" && result.discordPing) {
    return Response.json({ type: 1 });
  }

  const verifiedRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: rawBody,
  });

  const webhookOptions = {
    waitUntil: (task: Promise<unknown>) => {
      after(() => task);
    },
  };

  if (result.platform === "discord") {
    const bot = getAgentsChat("discord");
    registerAgentHandlers(bot);
    return bot.webhooks.discord(verifiedRequest, webhookOptions);
  }
  const bot = getAgentsChat("gchat");
  registerAgentHandlers(bot);
  return bot.webhooks.gchat(verifiedRequest, webhookOptions);
}
