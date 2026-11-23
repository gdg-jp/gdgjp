import { REANSWER_LABEL_EN, REANSWER_LABEL_JA, type Reply } from "../inquiry/inquiry";
import type { Delivery } from "../inquiry/pending";
import { chatAccessToken } from "./gchat-auth";

const DISCORD_API = "https://discord.com/api/v10";
const SUPPRESS_EMBEDS = 1 << 2;

export function discordComponents(reply: Reply) {
  const buttons: Array<Record<string, unknown>> = [
    { type: 2, style: 2, emoji: { name: "👍" }, custom_id: `fb:up:${reply.jobId}` },
    { type: 2, style: 2, emoji: { name: "👎" }, custom_id: `fb:down:${reply.jobId}` },
  ];
  if (reply.publicReply) {
    buttons.push({
      type: 2,
      style: 1,
      label: reply.english ? REANSWER_LABEL_EN : REANSWER_LABEL_JA,
      custom_id: `ra:${reply.jobId}`,
    });
  }
  return reply.degraded ? [] : [{ type: 1, components: buttons }];
}

export async function deliverDiscord(
  delivery: Extract<Delivery, { platform: "discord" }>,
  reply: Reply,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(
    `${DISCORD_API}/webhooks/${delivery.applicationId}/${delivery.interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: reply.text.slice(0, 2000),
        components: discordComponents(reply),
        allowed_mentions: { parse: [] },
        ...(reply.suppressEmbeds ? { flags: SUPPRESS_EMBEDS } : {}),
      }),
    },
  );
  if (!response.ok) throw new Error(`discord_deliver_failed:${response.status}`);
}

export async function progressDiscord(
  delivery: Extract<Delivery, { platform: "discord" }>,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(
    `${DISCORD_API}/webhooks/${delivery.applicationId}/${delivery.interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 2000), allowed_mentions: { parse: [] } }),
    },
  );
  if (!response.ok) throw new Error(`discord_progress_failed:${response.status}`);
}

export async function editDiscordMessage(
  delivery: Extract<Delivery, { platform: "discord-message" }>,
  body: Record<string, unknown>,
  botToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(
    `${DISCORD_API}/channels/${delivery.channelId}/messages/${delivery.messageId}`,
    {
      method: "PATCH",
      headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
      body: JSON.stringify({ allowed_mentions: { parse: [] }, ...body }),
    },
  );
  if (!response.ok) throw new Error(`discord_message_edit_failed:${response.status}`);
}

export function discordMessageBody(reply: Reply): Record<string, unknown> {
  return {
    content: reply.text.slice(0, 2000),
    components: discordComponents(reply),
    ...(reply.suppressEmbeds ? { flags: SUPPRESS_EMBEDS } : {}),
  };
}

export async function replyDiscordMessage(
  channelId: string,
  messageId: string,
  content: string,
  botToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      content: content.slice(0, 2000),
      message_reference: { message_id: messageId, fail_if_not_exists: false },
      allowed_mentions: { parse: [], replied_user: true },
    }),
  });
  if (!response.ok) throw new Error(`discord_reply_failed:${response.status}`);
  return ((await response.json()) as { id: string }).id;
}

export function chatCard(reply: Reply) {
  if (reply.degraded) return undefined;
  const button = (text: string, fn: string, value: string) => ({
    text,
    onClick: {
      action: {
        function: fn,
        parameters: [
          { key: "jobId", value: reply.jobId },
          { key: "value", value },
        ],
      },
    },
  });
  const buttons = [button("👍", "feedback", "up"), button("👎", "feedback", "down")];
  if (reply.publicReply) buttons.push(button("自分の権限で再回答（DM）", "reanswer", ""));
  return [{ cardId: "feedback", card: { sections: [{ widgets: [{ buttonList: { buttons } }] }] } }];
}

export async function deliverChat(
  delivery: Extract<Delivery, { platform: "google-chat" }>,
  reply: Reply,
  credentials: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const token = await chatAccessToken(credentials, fetchImpl);
  const url = new URL(`https://chat.googleapis.com/v1/${delivery.space}/messages`);
  if (delivery.thread)
    url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  const response = await fetchImpl(url.toString(), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      text: reply.text.replace(/<(https?:[^>]+)>/g, "$1"),
      ...(delivery.thread ? { thread: { name: delivery.thread } } : {}),
      ...(chatCard(reply) ? { cardsV2: chatCard(reply) } : {}),
    }),
  });
  if (!response.ok) throw new Error(`chat_deliver_failed:${response.status}`);
}
