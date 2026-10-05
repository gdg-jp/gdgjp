import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { pages } from "./pages";

export const translationJobs = sqliteTable("translation_jobs", {
  pageId: text("page_id")
    .primaryKey()
    .references(() => pages.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  sourceHash: text("source_hash"),
  requestedAt: integer("requested_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  leaseUntil: integer("lease_until", { mode: "timestamp" }),
  nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),
  attempts: integer("attempts").notNull().default(0),
  cacheHits: integer("cache_hits").notNull().default(0),
  cacheMisses: integer("cache_misses").notNull().default(0),
  lastError: text("last_error"),
});

export const translationSegments = sqliteTable("translation_segments", {
  cacheKey: text("cache_key").primaryKey(),
  translatedText: text("translated_text").notNull(),
  modelId: text("model_id").notNull(),
  formatVersion: text("format_version").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
