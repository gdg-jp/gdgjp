import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { chapters } from "./chapters";
import { ingestionSessions } from "./ingestion";
import { sources } from "./sources";
import { tags } from "./tags";
import { user } from "./user";

// ---------------------------------------------------------------------------
// pages
// ---------------------------------------------------------------------------
export const pages = sqliteTable("pages", {
  id: text("id").primaryKey(),
  titleJa: text("title_ja").notNull(),
  titleEn: text("title_en").notNull().default(""),
  slug: text("slug").notNull().unique(),
  contentJa: text("content_ja").notNull(),
  contentEn: text("content_en").notNull().default(""),
  translationStatusJa: text("translation_status_ja").notNull().default("human"),
  // "human" | "ai" | "missing"
  translationStatusEn: text("translation_status_en").notNull().default("missing"),
  summaryJa: text("summary_ja").notNull().default(""),
  summaryEn: text("summary_en").notNull().default(""),
  parentId: text("parent_id"),
  // self-reference; FK defined in migration SQL to avoid circular reference
  aclSyncedWithParent: integer("acl_synced_with_parent", { mode: "boolean" })
    .notNull()
    .default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("published"),
  // "published" | "archived"
  pageType: text("page_type"),
  // existing ingestion types plus event/venue/vendor/person/organization/playbook/answer/wiki-index/wiki-log | null
  pageMetadata: text("page_metadata"),
  ingestionSessionId: text("ingestion_session_id").references(() => ingestionSessions.id),
  actionabilityScore: integer("actionability_score"),
  // "restricted" | "unlisted" | "public"
  visibility: text("visibility").notNull().default("restricted"),
  // Used for every non-restricted general-access audience.
  generalRole: text("general_role").notNull().default("viewer"),
  chapterId: text("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
  authorId: text("author_id").notNull(),
  lastEditedBy: text("last_edited_by").notNull(),
  // "human" | "agent" — human pages appear under raw/ in clones; agent pages under pages/
  origin: text("origin").notNull().default("human"),
  // JSON array of source ids referenced by <acl src> spans in content_ja ∪ content_en.
  // Denormalized so listings / push gates avoid reparsing bodies.
  aclSourceIds: text("acl_source_ids").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  syncRevision: integer("sync_revision").notNull().default(1),
});

// Globally shared instructions materialized as AGENTS.md in every Wiki clone.
// This is deliberately a one-row table: instructions are not page content.
export const wikiAgentInstructions = sqliteTable("wiki_agent_instructions", {
  id: integer("id").primaryKey(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => user.id),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// page_tags (junction)
// ---------------------------------------------------------------------------
export const pageTags = sqliteTable(
  "page_tags",
  {
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    tagSlug: text("tag_slug")
      .notNull()
      .references(() => tags.slug),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.tagSlug] })],
);

// ---------------------------------------------------------------------------
// page_attachments
// ---------------------------------------------------------------------------
export const pageAttachments = sqliteTable("page_attachments", {
  id: text("id").primaryKey(),
  pageId: text("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// page_versions (last 10 retained per page)
// ---------------------------------------------------------------------------
export const pageVersions = sqliteTable("page_versions", {
  id: text("id").primaryKey(),
  pageId: text("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  contentJa: text("content_ja").notNull(),
  contentEn: text("content_en").notNull(),
  titleJa: text("title_ja").notNull(),
  titleEn: text("title_en").notNull(),
  editedBy: text("edited_by").notNull(),
  savedAt: integer("saved_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// page_favorites
// ---------------------------------------------------------------------------
export const pageFavorites = sqliteTable(
  "page_favorites",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })],
);

// ---------------------------------------------------------------------------
// page_sources (ingestion source URLs)
// ---------------------------------------------------------------------------
export const pageSources = sqliteTable("page_sources", {
  id: text("id").primaryKey(),
  pageId: text("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  title: text("title").notNull(),
  sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// page_comments
// ---------------------------------------------------------------------------
export const pageComments = sqliteTable("page_comments", {
  id: text("id").primaryKey(),
  pageId: text("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  authorId: text("author_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  // null = top-level; self-FK defined in SQL migration to avoid circular Drizzle ref
  contentJson: text("content_json").notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// comment_reactions
// ---------------------------------------------------------------------------
export const commentReactions = sqliteTable(
  "comment_reactions",
  {
    commentId: text("comment_id")
      .notNull()
      .references(() => pageComments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId, t.emoji] })],
);

// ---------------------------------------------------------------------------
// page_embedding_status (Vectorize embedding tracking)
// ---------------------------------------------------------------------------
export const pageEmbeddingStatus = sqliteTable("page_embedding_status", {
  pageId: text("page_id")
    .primaryKey()
    .references(() => pages.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  // "pending" | "indexed" | "error"
  chunkCount: integer("chunk_count").notNull().default(0),
  contentHash: text("content_hash"),
  lastIndexedAt: integer("last_indexed_at", { mode: "timestamp" }),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// page_views (per-user view tracking for "Recently Viewed")
// ---------------------------------------------------------------------------
export const pageViews = sqliteTable(
  "page_views",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    viewedAt: integer("viewed_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })],
);

// ---------------------------------------------------------------------------
// page_access (per-page share subjects)
// ---------------------------------------------------------------------------
export const pageAccess = sqliteTable("page_access", {
  id: text("id").primaryKey(),
  pageId: text("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  // "email" | "chapter". subjectKey is a normalized email or an accounts chapter ID.
  subjectType: text("subject_type").notNull(),
  subjectKey: text("subject_key").notNull(),
  subjectLabel: text("subject_label").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  // "viewer" | "commenter" | "editor". Owners are implicit page authors.
  role: text("role").notNull().default("viewer"),
  grantedBy: text("granted_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});
