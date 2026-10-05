import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./user";

// ---------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  // "ingestion_done" | "ingestion_error" | ...
  titleJa: text("title_ja").notNull(),
  titleEn: text("title_en").notNull(),
  refId: text("ref_id"),
  refUrl: text("ref_url"),
  readAt: integer("read_at", { mode: "timestamp" }),
  emailedAt: integer("emailed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// fcm_tokens (push notification device tokens)
// ---------------------------------------------------------------------------
export const fcmTokens = sqliteTable("fcm_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  deviceLabel: text("device_label"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});
