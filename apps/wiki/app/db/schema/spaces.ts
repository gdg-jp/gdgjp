import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./user";

// ---------------------------------------------------------------------------
// spaces — tenant layer outside the page/source ACL (knowledge platform v2).
// ---------------------------------------------------------------------------
export const spaces = sqliteTable("spaces", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // "personal" | "chapter" | "shared"
  kind: text("kind").notNull(),
  // Opaque Accounts chapter id; set only for chapter spaces (one space per chapter).
  chapterId: text("chapter_id").unique(),
  // "ja" | "en"
  lang: text("lang").notNull().default("ja"),
  translateEnabled: integer("translate_enabled", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const spaceMembers = sqliteTable(
  "space_members",
  {
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    // "user" | "public" | "chapter_role" | "discord_guild" | "chat_space"
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    // "owner" | "editor" | "viewer"
    role: text("role").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.principalType, t.principalId] }),
    index("idx_space_members_principal").on(t.principalType, t.principalId),
  ],
);

export const reviewFlags = sqliteTable("review_flags", {
  id: text("id").primaryKey(),
  spaceId: text("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  // "page" | "source" | "job"
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  kind: text("kind").notNull(),
  payload: text("payload").notNull().default("{}"),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
