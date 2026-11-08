import type { Env } from "./env";
import type { AuthDeps } from "./features/auth/accounts";
import { d1LinkStore } from "./features/auth/links";
import {
  deliverChat,
  deliverDiscord,
  discordMessageBody,
  editDiscordMessage,
  progressDiscord,
} from "./features/chat/deliver";
import type { InquiryDeps, Reply } from "./features/inquiry/inquiry";
import { type Delivery, type PendingStore, d1PendingStore } from "./features/inquiry/pending";
import { type WikiClient, wikiClient } from "./features/inquiry/wiki";

/** Per-request dependency graph; built from bindings so tests can swap any part. */
export type App = {
  env: Env;
  auth: AuthDeps;
  wiki: WikiClient;
  pending: PendingStore;
  inquiry: InquiryDeps;
  deliver(delivery: Delivery, reply: Reply): Promise<void>;
  guildSpaces(guildId: string): Promise<string[]>;
  chatSpaces(chatSpace: string): Promise<string[]>;
};

export function createApp(env: Env): App {
  const wiki = wikiClient(env.WIKI, env.AGENT_SERVICE_TOKEN);
  const pending = d1PendingStore(env.DB);
  const deliver = (delivery: Delivery, reply: Reply) =>
    delivery.platform === "discord"
      ? deliverDiscord(delivery, reply)
      : delivery.platform === "discord-message"
        ? editDiscordMessage(delivery, discordMessageBody(reply), env.DISCORD_BOT_TOKEN)
        : deliverChat(delivery, reply, env.GOOGLE_CHAT_CREDENTIALS);
  const slugs = async (sql: string, key: string) =>
    (await env.DB.prepare(sql).bind(key).all<{ space_slug: string }>()).results.map(
      (row) => row.space_slug,
    );
  return {
    env,
    auth: { env, links: d1LinkStore(env.DB), kv: env.KV },
    wiki,
    pending,
    deliver,
    inquiry: {
      wiki,
      pending,
      deliver,
      progress: async (delivery, text) => {
        if (delivery.platform === "discord") await progressDiscord(delivery, text);
        if (delivery.platform === "discord-message")
          await editDiscordMessage(
            delivery,
            { content: text.slice(0, 2000) },
            env.DISCORD_BOT_TOKEN,
          );
      },
      schedule: async () => {
        await env.PENDING.get(env.PENDING.idFromName("sweep")).fetch("https://pending/arm", {
          method: "POST",
        });
      },
    },
    guildSpaces: (guildId) =>
      slugs("SELECT space_slug FROM guild_spaces WHERE guild_id = ?", guildId),
    chatSpaces: (chatSpace) =>
      slugs("SELECT space_slug FROM chat_spaces WHERE chat_space = ?", chatSpace),
  };
}
