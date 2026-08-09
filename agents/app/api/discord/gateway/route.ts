import { after } from "next/server";

import { getAgentsChat } from "@/lib/adapters";
import { registerAgentHandlers } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * Keeps a short-lived Discord Gateway connection open for regular messages.
 * Vercel Cron invokes this every nine minutes; each listener runs for ten.
 */
export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const bot = getAgentsChat("discord");
  registerAgentHandlers(bot);
  await bot.initialize();

  const discord = bot.getAdapter("discord");
  return discord.startGatewayListener(
    { waitUntil: (task: Promise<unknown>) => after(() => task) },
    10 * 60 * 1000,
    undefined,
    new URL("/api/chat", request.url).toString(),
  );
}
