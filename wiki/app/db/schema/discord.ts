import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { chapters } from "./chapters";
import { user } from "./user";

/** Per-user Discord OAuth tokens for the /sources guild picker (`identify` + `guilds`). */
export const discordOauthTokens = sqliteTable("discord_oauth_tokens", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  /** Space-delimited OAuth scopes from the token-exchange response. */
  grantedScopes: text("granted_scopes"),
  /** Discord snowflake from `/users/@me` at consent time. */
  discordUserId: text("discord_user_id"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// discord_guild_settings (per-chapter Discord server reminder channel config)
// ---------------------------------------------------------------------------
export const discordGuildSettings = sqliteTable("discord_guild_settings", {
  guildId: text("guild_id").primaryKey(),
  chapterId: text("chapter_id")
    .notNull()
    .unique()
    .references(() => chapters.id, { onDelete: "cascade" }),
  reminderChannelId: text("reminder_channel_id").notNull(),
  enabled: integer("enabled").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
