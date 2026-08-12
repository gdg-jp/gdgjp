/**
 * Discord REST helpers for guild/channel listing (picker) and message fetch (import).
 */

import { DISCORD_API } from "~/lib/discord-oauth.server";

const API_TIMEOUT_MS = 30_000;

/** Guild text + announcement channels are importable as sources. */
export const DISCORD_IMPORTABLE_CHANNEL_TYPES = new Set([0, 5]);

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner?: boolean;
  permissions?: string;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  position?: number;
  parent_id?: string | null;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  url: string;
  proxy_url?: string;
  content_type?: string | null;
  size: number;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  attachments?: DiscordAttachment[];
  embeds?: Array<{ url?: string | null; title?: string | null }>;
  type?: number;
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function bearerHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

function botHeaders(botToken: string): HeadersInit {
  return { Authorization: `Bot ${botToken}` };
}

export async function listUserGuilds(accessToken: string): Promise<DiscordGuild[]> {
  const response = await fetchWithTimeout(`${DISCORD_API}/users/@me/guilds?limit=200`, {
    headers: bearerHeaders(accessToken),
  });
  if (!response.ok) {
    throw new Error(`Discord users/@me/guilds failed (${response.status})`);
  }
  return (await response.json()) as DiscordGuild[];
}

export async function listBotGuilds(botToken: string): Promise<DiscordGuild[]> {
  const response = await fetchWithTimeout(`${DISCORD_API}/users/@me/guilds?limit=200`, {
    headers: botHeaders(botToken),
  });
  if (!response.ok) {
    throw new Error(`Discord bot guilds failed (${response.status})`);
  }
  return (await response.json()) as DiscordGuild[];
}

export async function listGuildChannels(
  botToken: string,
  guildId: string,
): Promise<DiscordChannel[]> {
  const response = await fetchWithTimeout(
    `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/channels`,
    { headers: botHeaders(botToken) },
  );
  if (response.status === 403 || response.status === 404) {
    const error = new Error(`Discord guild channels unavailable (${response.status})`);
    (error as Error & { code?: string }).code = "bot_missing";
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Discord guild channels failed (${response.status})`);
  }
  return (await response.json()) as DiscordChannel[];
}

export async function listChannelMessages(
  botToken: string,
  channelId: string,
  params: { limit?: number; before?: string; after?: string },
): Promise<DiscordMessage[]> {
  const search = new URLSearchParams({ limit: String(params.limit ?? 100) });
  if (params.before) search.set("before", params.before);
  if (params.after) search.set("after", params.after);

  const response = await fetchWithTimeout(
    `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages?${search}`,
    { headers: botHeaders(botToken) },
  );
  if (response.status === 403 || response.status === 404) {
    const error = new Error(`Discord channel messages unavailable (${response.status})`);
    (error as Error & { code?: string }).code = "bot_missing";
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Discord channel messages failed (${response.status})`);
  }
  return (await response.json()) as DiscordMessage[];
}

export function discordChannelUrl(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

export function parseDiscordChannelUrl(url: string): { guildId: string; channelId: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "discord.com" && parsed.hostname !== "discordapp.com") return null;
    const match = parsed.pathname.match(/^\/channels\/(\d+)\/(\d+)\/?$/);
    if (!match) return null;
    return { guildId: match[1], channelId: match[2] };
  } catch {
    return null;
  }
}

/** Discord epoch snowflake for a Unix millisecond timestamp (approximate lower bound). */
export function snowflakeFromUnixMs(ms: number): string {
  const discordEpoch = 1_420_070_400_000n;
  const value = (BigInt(Math.max(0, Math.floor(ms))) - discordEpoch) << 22n;
  return value < 0n ? "0" : value.toString();
}

export function authorDisplayName(author: DiscordUser | undefined): string {
  if (!author) return "Unknown user";
  if (author.bot) return author.global_name?.trim() || author.username || "Bot";
  return author.global_name?.trim() || author.username || "Unknown user";
}
