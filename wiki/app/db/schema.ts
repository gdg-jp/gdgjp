import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// better-auth managed tables
// Column names are camelCase to match better-auth's generated SQL migrations.
// ---------------------------------------------------------------------------
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  // additionalFields
  role: text("role").notNull().default("pending"),
  chapterId: text("chapterId"),
  preferredUiLanguage: text("preferredUiLanguage").notNull().default("ja"),
  preferredContentLanguage: text("preferredContentLanguage").notNull().default("ja"),
  discordId: text("discord_id").unique(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }),
  updatedAt: integer("updatedAt", { mode: "timestamp" }),
});

// ---------------------------------------------------------------------------
// chapters
// ---------------------------------------------------------------------------
export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(),
  nameJa: text("name_ja").notNull(),
  nameEn: text("name_en").notNull(),
  abbreviation: text("abbreviation").notNull().default(""),
  university: text("university").notNull(),
  region: text("region").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// invitations
// ---------------------------------------------------------------------------
export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  chapterId: text("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  // "lead" | "member" | "viewer"
  invitedBy: text("invited_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
  acceptedAt: integer("accepted_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// tags (canonical global taxonomy)
// ---------------------------------------------------------------------------
export const tags = sqliteTable("tags", {
  slug: text("slug").primaryKey(),
  labelJa: text("label_ja").notNull(),
  labelEn: text("label_en").notNull(),
  color: text("color").notNull(),
  pageCount: integer("page_count").notNull().default(0),
});

// ---------------------------------------------------------------------------
// ingestion_sessions
// ---------------------------------------------------------------------------
export const ingestionSessions = sqliteTable("ingestion_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  status: text("status").notNull().default("pending"),
  // "pending" | "processing" | "done" | "error" | "archived" | "awaiting_clarification"
  inputsJson: text("inputs_json").notNull(),
  // JSON: { texts: string[], imageKeys: string[], googleDocUrls: string[] }
  aiDraftJson: text("ai_draft_json"),
  errorMessage: text("error_message"),
  phaseMessage: text("phase_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

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
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("draft"),
  // "draft" | "published" | "archived"
  pageType: text("page_type"),
  // "event-report" | "speaker-profile" | "project-log" | "how-to-guide" | "onboarding-guide" | "survey-report" | null
  pageMetadata: text("page_metadata"),
  ingestionSessionId: text("ingestion_session_id").references(() => ingestionSessions.id),
  actionabilityScore: integer("actionability_score"),
  visibility: text("visibility").notNull().default("public"),
  chapterId: text("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
  authorId: text("author_id").notNull(),
  lastEditedBy: text("last_edited_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
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
// google_drive_tokens (per-user OAuth tokens for Drive integration)
// ---------------------------------------------------------------------------
export const googleDriveTokens = sqliteTable("google_drive_tokens", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
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

// ---------------------------------------------------------------------------
// task_lists (metadata extension for pages with pageType="task-list")
// ---------------------------------------------------------------------------
export const taskLists = sqliteTable("task_lists", {
  pageId: text("page_id")
    .primaryKey()
    .references(() => pages.id, { onDelete: "cascade" }),
  nextTaskNumber: integer("next_task_number").notNull().default(1),
});

// ---------------------------------------------------------------------------
// task_list_teams (teams defined per task list)
// ---------------------------------------------------------------------------
export const taskListTeams = sqliteTable("task_list_teams", {
  id: text("id").primaryKey(),
  taskListId: text("task_list_id")
    .notNull()
    .references(() => taskLists.pageId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").default("#6b7280"),
  sortOrder: integer("sort_order").default(0),
});

// ---------------------------------------------------------------------------
// tasks (individual task items)
// ---------------------------------------------------------------------------
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  taskListId: text("task_list_id")
    .notNull()
    .references(() => taskLists.pageId, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("todo"),
  // "todo" | "in_progress" | "done" | "cancelled" | "duplicated"
  type: text("type").notNull().default("task"),
  // "task" | "discussion"
  dueDate: text("due_date"),
  assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
  assigneeName: text("assignee_name"),
  teamId: text("team_id").references(() => taskListTeams.id, { onDelete: "set null" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// task_dependencies (junction table)
// ---------------------------------------------------------------------------
export const taskDependencies = sqliteTable(
  "task_dependencies",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: text("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })],
);

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
// page_access (per-page fine-grained access control)
// ---------------------------------------------------------------------------
export const pageAccess = sqliteTable("page_access", {
  id: text("id").primaryKey(),
  pageId: text("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  // "owner" | "editor" | "viewer"
  pageRole: text("page_role").notNull().default("viewer"),
  grantedBy: text("granted_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
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
