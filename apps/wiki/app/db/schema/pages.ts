import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { chapters } from "./chapters";
import { ingestionSessions } from "./ingestion";
import { sources } from "./sources";
import { spaces } from "./spaces";
import { tags } from "./tags";
import { user } from "./user";

export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .default("gdg-jp")
      .references(() => spaces.id),
    titleJa: text("title_ja").notNull(),
    titleEn: text("title_en").notNull().default(""),
    slug: text("slug").notNull(),
    contentJa: text("content_ja").notNull(),
    contentEn: text("content_en").notNull().default(""),
    translationStatusJa: text("translation_status_ja").notNull().default("human"),
    translationStatusEn: text("translation_status_en").notNull().default("missing"),
    summaryJa: text("summary_ja").notNull().default(""),
    summaryEn: text("summary_en").notNull().default(""),
    parentId: text("parent_id"),
    aclSyncedWithParent: integer("acl_synced_with_parent", { mode: "boolean" })
      .notNull()
      .default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    status: text("status").notNull().default("published"),
    pageType: text("page_type"),
    pageMetadata: text("page_metadata"),
    ingestionSessionId: text("ingestion_session_id").references(() => ingestionSessions.id),
    actionabilityScore: integer("actionability_score"),
    visibility: text("visibility").notNull().default("restricted"),
    generalRole: text("general_role").notNull().default("viewer"),
    chapterId: text("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
    authorId: text("author_id").notNull(),
    lastEditedBy: text("last_edited_by").notNull(),
    origin: text("origin").notNull().default("human"),
    aclSourceIds: text("acl_source_ids").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    syncRevision: integer("sync_revision").notNull().default(1),
    translationSourceHash: text("translation_source_hash"),
  },
  (t) => [unique("pages_space_id_slug_unique").on(t.spaceId, t.slug)],
);

export const wikiAgentInstructions = sqliteTable("wiki_agent_instructions", {
  id: integer("id").primaryKey(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => user.id),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

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

export const pageComments = sqliteTable("page_comments", {
  id: text("id").primaryKey(),
  pageId: text("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  authorId: text("author_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  contentJson: text("content_json").notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

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

export const pageAccess = sqliteTable("page_access", {
  id: text("id").primaryKey(),
  pageId: text("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  subjectType: text("subject_type").notNull(),
  subjectKey: text("subject_key").notNull(),
  subjectLabel: text("subject_label").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  role: text("role").notNull().default("viewer"),
  grantedBy: text("granted_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});
