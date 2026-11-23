import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  preferredUiLanguage: text("preferred_ui_language").notNull().default("ja"),
  preferredContentLanguage: text("preferred_content_language").notNull().default("ja"),
  discordId: text("discord_id").unique(),
  lastSpaceId: text("last_space_id"),
  hideAgentPages: integer("hide_agent_pages", { mode: "boolean" }).notNull().default(false),
});
