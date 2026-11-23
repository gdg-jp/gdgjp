import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { user } from "./user";

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  spaceId: text("space_id").notNull().default("gdg-jp"),
  externalId: text("external_id"),
  url: text("url").notNull(),
  title: text("title").notNull(),
  chapterId: text("chapter_id"),
  visibility: text("visibility").notNull().default("member"),
  addedBy: text("added_by")
    .notNull()
    .references(() => user.id),
  status: text("status").notNull().default("pending"),
  refreshPolicy: text("refresh_policy").notNull().default("manual"),
  fetchAttemptId: text("fetch_attempt_id"),
  lastFetchedAt: integer("last_fetched_at", { mode: "timestamp" }),
  errorMessage: text("error_message"),
  config: text("config"),
  lastIntegratedAt: integer("last_integrated_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const sourceDocuments = sqliteTable(
  "source_documents",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    title: text("title").notNull(),
    r2Key: text("r2_key").notNull(),
    contentHash: text("content_hash").notNull(),
    mediaType: text("media_type").notNull().default("text/markdown"),
    capturedAt: integer("captured_at", { mode: "timestamp" }).notNull(),
    cursor: text("cursor"),
    metadata: text("metadata"),
    status: text("status").notNull().default("ready"),
    integratedHash: text("integrated_hash"),
  },
  (t) => [unique("source_documents_source_id_path_unique").on(t.sourceId, t.path)],
);

export const sourceAssets = sqliteTable("source_assets", {
  id: text("id").primaryKey(),
  sourceDocumentId: text("source_document_id")
    .notNull()
    .references(() => sourceDocuments.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  r2Key: text("r2_key").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  contentHash: text("content_hash").notNull(),
});

export const googleChatSenderProfiles = sqliteTable("google_chat_sender_profiles", {
  resourceName: text("resource_name").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const googleChatSenderSamples = sqliteTable(
  "google_chat_sender_samples",
  {
    id: text("id").primaryKey(),
    resourceName: text("resource_name").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    messageName: text("message_name").notNull(),
    messageText: text("message_text").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [unique().on(t.resourceName, t.sourceId, t.messageName)],
);

export const sourceImportRuns = sqliteTable("source_import_runs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .unique()
    .references(() => sources.id, { onDelete: "cascade" }),
  fetchAttemptId: text("fetch_attempt_id").notNull(),
  kind: text("kind").notNull(),
  sinceCursor: text("since_cursor"),
  phase: text("phase").notNull().default("start"),
  progress: text("progress").notNull().default("{}"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
