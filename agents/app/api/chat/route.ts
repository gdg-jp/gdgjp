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

  const bot = getAgentsChat();
  registerAgentHandlers(bot);

  const webhookOptions = {
    waitUntil: (task: Promise<unknown>) => {
      after(() => task);
    },
  };

  if (result.platform === "discord") {
    return bot.webhooks.discord(verifiedRequest, webhookOptions);
  }
  return bot.webhooks.gchat(verifiedRequest, webhookOptions);
}
