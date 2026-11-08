import {
  getGoogleDriveDocumentKind,
  googleDriveFolderIdFromUrl,
  googleDriveFolderUrl,
  isGoogleDriveUrl,
} from "~/features/google/drive-utils";
import { isGoogleFormUrl } from "~/features/google/forms-utils";
import type { SourceKind } from "~/features/sources/shared";

export type ClassifiedSource =
  | {
      ok: true;
      kind: SourceKind;
      url: string;
      externalId: string | null;
      title?: string;
      /** Kind-specific settings stored in sources.config (JSON). */
      config?: string;
    }
  | { ok: false; error: string };

function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

const SPACE_NAME_RE = /^spaces\/[A-Za-z0-9_-]+$/;
const DISCORD_SNOWFLAKE_RE = /^\d{5,32}$/;

/** Build the canonical Chat Space URL stored on the sources row. */
export function googleChatSpaceUrl(spaceName: string): string {
  const id = spaceName.replace(/^spaces\//, "");
  return `https://mail.google.com/chat/u/0/#chat/space/${id}`;
}

/** Canonical Discord channel deep link stored on the sources row. */
export function discordChannelSourceUrl(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

/** Normalize and classify a user-supplied URL for Stage 1 source registration. */
export function classifySourceUrl(raw: string, title?: unknown): ClassifiedSource {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "url_required" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalid_url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "unsupported_url" };
  }

  const href = url.toString();

  if (isGoogleFormUrl(href)) {
    return { ok: false, error: "unsupported_url" };
  }

  const folderId = googleDriveFolderIdFromUrl(href);
  if (folderId) {
    return {
      ok: true,
      kind: "google-drive-folder",
      url: googleDriveFolderUrl(folderId),
      externalId: folderId,
      ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
    };
  }

  if (isGoogleDriveUrl(href)) {
    const documentKind = getGoogleDriveDocumentKind(href);
    if (!documentKind) return { ok: false, error: "unsupported_url" };
    const externalId = extractDriveFileId(href);
    if (!externalId) return { ok: false, error: "invalid_url" };
    const kind: SourceKind =
      documentKind === "document"
        ? "google-doc"
        : documentKind === "spreadsheet"
          ? "google-sheet"
          : "google-slides";
    return {
      ok: true,
      kind,
      url: href,
      externalId,
      ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
    };
  }

  return { ok: true, kind: "website", url: href, externalId: null };
}

/**
 * Classify a Space chosen from the Chat picker. `externalId` must be `spaces/…`.
 */
export function classifyGoogleChatSpace(externalId: unknown, title: unknown): ClassifiedSource {
  if (typeof externalId !== "string" || !SPACE_NAME_RE.test(externalId)) {
    return { ok: false, error: "invalid_space" };
  }
  const displayTitle = typeof title === "string" && title.trim() ? title.trim() : externalId;
  return {
    ok: true,
    kind: "google-chat-space",
    url: googleChatSpaceUrl(externalId),
    externalId,
    title: displayTitle,
  };
}

/**
 * Classify a Discord channel from the picker. `externalId` is the channel snowflake;
 * `url` must be `https://discord.com/channels/{guildId}/{channelId}`.
 */
export function classifyDiscordChannel(
  externalId: unknown,
  title: unknown,
  url: unknown,
): ClassifiedSource {
  if (typeof externalId !== "string" || !DISCORD_SNOWFLAKE_RE.test(externalId)) {
    return { ok: false, error: "invalid_channel" };
  }
  if (typeof url !== "string") return { ok: false, error: "invalid_url" };
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  const match = parsed.pathname.match(/^\/channels\/(\d+)\/(\d+)\/?$/);
  if (
    (parsed.hostname !== "discord.com" && parsed.hostname !== "discordapp.com") ||
    !match ||
    match[2] !== externalId
  ) {
    return { ok: false, error: "invalid_channel" };
  }
  const guildId = match[1];
  const displayTitle = typeof title === "string" && title.trim() ? title.trim() : `#${externalId}`;
  return {
    ok: true,
    kind: "discord-channel",
    url: discordChannelSourceUrl(guildId, externalId),
    externalId,
    title: displayTitle,
  };
}

/** Canonical Discord server link stored on the sources row. */
export function discordGuildSourceUrl(guildId: string): string {
  return `https://discord.com/channels/${guildId}`;
}

/** Which channels of a Discord server a `discord-guild` source imports. */
export type DiscordGuildConfig = {
  /** The whole server: every text channel, including ones created later (minus `exclude`). */
  all: boolean;
  include: { categories: string[]; channels: string[] };
  exclude: { channels: string[] };
  /** Pick up channels created later under the included categories. */
  autoDiscover: boolean;
};

function snowflakeList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter(
    (id): id is string => typeof id === "string" && DISCORD_SNOWFLAKE_RE.test(id),
  );
  return ids.length === value.length && ids.length <= 500 ? [...new Set(ids)] : null;
}

export function parseDiscordGuildConfig(value: unknown): DiscordGuildConfig | null {
  const raw = typeof value === "string" ? safeJson(value) : value;
  if (!raw || typeof raw !== "object") return null;
  const config = raw as Record<string, unknown>;
  const include = (config.include ?? {}) as Record<string, unknown>;
  const exclude = (config.exclude ?? {}) as Record<string, unknown>;
  const categories = snowflakeList(include.categories ?? []);
  const channels = snowflakeList(include.channels ?? []);
  const excluded = snowflakeList(exclude.channels ?? []);
  if (!categories || !channels || !excluded) return null;
  const all = config.all === true;
  if (!all && categories.length === 0 && channels.length === 0) return null;
  return {
    all,
    include: { categories, channels },
    exclude: { channels: excluded },
    autoDiscover: all || config.autoDiscover === true,
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Classify a Discord server picked with a channel / category selection. */
export function classifyDiscordGuild(
  externalId: unknown,
  title: unknown,
  config: unknown,
): ClassifiedSource {
  if (typeof externalId !== "string" || !DISCORD_SNOWFLAKE_RE.test(externalId)) {
    return { ok: false, error: "invalid_guild" };
  }
  const parsed = parseDiscordGuildConfig(config);
  if (!parsed) return { ok: false, error: "invalid_guild_selection" };
  const displayTitle = typeof title === "string" && title.trim() ? title.trim() : externalId;
  return {
    ok: true,
    kind: "discord-guild",
    url: discordGuildSourceUrl(externalId),
    externalId,
    title: displayTitle,
    config: JSON.stringify(parsed),
  };
}
