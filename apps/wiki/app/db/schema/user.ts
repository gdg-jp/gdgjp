import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// user — populated by the openid-client RP factory from IdP /userinfo at
// sign-in. is_admin reflects the value at last sign-in; fresh checks should
// go through getFreshClaims().
// ---------------------------------------------------------------------------
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  image: text("image"),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// Wiki-specific user fields split out of `user` when migrating off better-auth
// so the user shape stays uniform across all RPs.
export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  preferredUiLanguage: text("preferred_ui_language").notNull().default("ja"),
  preferredContentLanguage: text("preferred_content_language").notNull().default("ja"),
  discordId: text("discord_id").unique(),
});
