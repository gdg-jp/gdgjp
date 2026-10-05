import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { user } from "./user";

// ---------------------------------------------------------------------------
// sources / source_documents / source_assets — raw layer (LLM Wiki pattern)
// ---------------------------------------------------------------------------
export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  // "google-doc" | "google-sheet" | "google-slides" | "google-chat-space" |
  // "discord-channel" | "website" | "upload" | "text" | "conversation"
  kind: text("kind").notNull(),
  externalId: text("external_id"),
  url: text("url").notNull(),
  title: text("title").notNull(),
  // Opaque Accounts chapter id — not an FK. Local `chapters` is unsynced; /sources
  // resolves labels from the Accounts directory / IdP memberships instead.
  chapterId: text("chapter_id"),
  // "private" | "member" | "organizer" | "chapter-member" | "chapter-organizer"
  visibility: text("visibility").notNull().default("member"),
  addedBy: text("added_by")
    .notNull()
    .references(() => user.id),
  // "pending" | "fetching" | "ready" | "error" | "archived"
  status: text("status").notNull().default("pending"),
  // "manual" | "daily" | "weekly"
  refreshPolicy: text("refresh_policy").notNull().default("manual"),
  /** Ownership token for the pending refresh request or active fetch attempt. */
  fetchAttemptId: text("fetch_attempt_id"),
  lastFetchedAt: integer("last_fetched_at", { mode: "timestamp" }),
  errorMessage: text("error_message"),
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
    /** JSON blob (e.g. extracted URLs). Nullable; Stage 3 reads this. */
    metadata: text("metadata"),
    // "ready" | "error" | "archived"
    status: text("status").notNull().default("ready"),
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

/** Manually configured Google Chat resource-name → display-name mappings. */
export const googleChatSenderProfiles = sqliteTable("google_chat_sender_profiles", {
  resourceName: text("resource_name").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

/** At most ten recent identification examples are retained per sender. */
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

// ---------------------------------------------------------------------------
// source_import_runs — Durable Object alarm-driven source import progress
// ---------------------------------------------------------------------------
export const sourceImportRuns = sqliteTable("source_import_runs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .unique()
    .references(() => sources.id, { onDelete: "cascade" }),
  fetchAttemptId: text("fetch_attempt_id").notNull(),
  // Driver identity, rather than a source kind: Docs/Sheets/Slides share the
  // Google Drive driver and therefore do not require a migration per MIME type.
  kind: text("kind").notNull(),
  // Only the source-document cursor must exist before a Durable Object starts.
  sinceCursor: text("since_cursor"),
  // JSON summary is flushed when phases change. Per-step cursors live in the
  // object-local SQLite meta table and do not consume subrequest budget.
  phase: text("phase").notNull().default("start"),
  progress: text("progress").notNull().default("{}"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
