import type { App } from "../../app";
import { replyDiscordMessage } from "./deliver";
import { type DiscordAsk, runAsk } from "./discord";

export type GatewayMessage = {
  id: string;
  channel_id: string;
  guild_id?: string;
  webhook_id?: string;
  author?: { id: string; bot?: boolean };
  content?: string;
  mentions?: Array<{ id: string }>;
};

export const PLACEHOLDER = "🔎 wiki を調べています…";
export const MENTION_HELP =
  "質問をメンションと一緒に書いてください（例: @GDG Agent DevFest の会場は？）。/ask でも質問できます。";

export function mentionQuestion(message: GatewayMessage, botId: string): string | null {
  if (!message.author || message.author.bot || message.webhook_id) return null;
  const direct = !message.guild_id;
  const mentioned = (message.mentions ?? []).some((user) => user.id === botId);
  if (!direct && !mentioned) return null;
  return (message.content ?? "").replace(new RegExp(`<@!?${botId}>`, "g"), " ").trim();
}

export async function handleDiscordMessage(
  app: App,
  message: GatewayMessage,
  botToken: string,
): Promise<void> {
  const botId = app.env.DISCORD_APPLICATION_ID;
  const question = mentionQuestion(message, botId);
  if (question === null || !message.author) return;
  if (!question) {
    await replyDiscordMessage(message.channel_id, message.id, MENTION_HELP, botToken);
    return;
  }
  const placeholder = await replyDiscordMessage(
    message.channel_id,
    message.id,
    PLACEHOLDER,
    botToken,
  );
  const ask: DiscordAsk = {
    delivery: {
      platform: "discord-message",
      channelId: message.channel_id,
      messageId: placeholder,
    },
    guildId: message.guild_id,
    userId: message.author.id,
    question,
    privateReply: false,
  };
  await runAsk(app, ask);
}
