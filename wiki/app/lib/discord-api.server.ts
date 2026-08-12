/**
 * Discord REST helpers for guild/channel listing (picker) and message fetch (import).
 */

import { DISCORD_API } from "~/lib/discord-oauth.server";

const API_TIMEOUT_MS = 30_000;

/** Guild text + announcement channels are importable as sources. */
export const DISCORD_IMPORTABLE_CHANNEL_TYPES = new Set([0, 5]);

/** Discord GUILD_CATEGORY channel type. */
export const DISCORD_CATEGORY_CHANNEL_TYPE = 4;

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

export type DiscordChannelListItem = {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
};

export type DiscordChannelGroup = {
  categoryId: string | null;
  categoryName: string | null;
  channels: DiscordChannelListItem[];
};

function channelPosition(channel: DiscordChannel): number {
  return channel.position ?? 0;
}

function compareChannels(a: DiscordChannel, b: DiscordChannel): number {
  const byPosition = channelPosition(a) - channelPosition(b);
  if (byPosition !== 0) return byPosition;
  return a.name.localeCompare(b.name, "ja");
}

function toChannelListItem(channel: DiscordChannel): DiscordChannelListItem {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parent_id ?? null,
  };
}

/**
 * Group importable guild channels under their Discord categories, preserving
 * Discord sidebar order (uncategorized first, then categories by position).
 */
export function groupDiscordChannelsByCategory(channels: DiscordChannel[]): DiscordChannelGroup[] {
  const categories = channels
    .filter((channel) => channel.type === DISCORD_CATEGORY_CHANNEL_TYPE)
    .sort(compareChannels);
  const categoryIds = new Set(categories.map((category) => category.id));

  const importable = channels
    .filter((channel) => DISCORD_IMPORTABLE_CHANNEL_TYPES.has(channel.type))
    .sort(compareChannels);

  const byParent = new Map<string | null, DiscordChannel[]>();
  for (const channel of importable) {
    const parentId =
      channel.parent_id && categoryIds.has(channel.parent_id) ? channel.parent_id : null;
    const list = byParent.get(parentId) ?? [];
    list.push(channel);
    byParent.set(parentId, list);
  }

  const groups: DiscordChannelGroup[] = [];
  const uncategorized = byParent.get(null);
  if (uncategorized?.length) {
    groups.push({
      categoryId: null,
      categoryName: null,
      channels: uncategorized.map(toChannelListItem),
    });
  }

  for (const category of categories) {
    const children = byParent.get(category.id);
    if (!children?.length) continue;
    groups.push({
      categoryId: category.id,
      categoryName: category.name,
      channels: children.map(toChannelListItem),
    });
  }

  return groups;
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
