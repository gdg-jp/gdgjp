import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { pages } from "./pages";
import { user } from "./user";

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
  /** Space-delimited OAuth scopes from the token-exchange response. */
  grantedScopes: text("granted_scopes"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// google_document_imports / google_document_import_nodes
// ---------------------------------------------------------------------------
// Direct Google Docs imports retain source provenance independently from the
// generic AI-ingestion sources. `__document_root__` is the application-defined
// sourceNodeId for the document root; all non-root values are Google tab IDs.
export const googleDocumentImports = sqliteTable("google_document_imports", {
  documentId: text("document_id").primaryKey(),
  rootPageId: text("root_page_id")
    .notNull()
    .unique()
    .references(() => pages.id, { onDelete: "cascade" }),
  importedBy: text("imported_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // "ready" | "syncing" | "failed"
  status: text("status").notNull().default("ready"),
  errorMessage: text("error_message"),
  lastImportedAt: integer("last_imported_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const googleDocumentImportNodes = sqliteTable(
  "google_document_import_nodes",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => googleDocumentImports.documentId, { onDelete: "cascade" }),
    sourceNodeId: text("source_node_id").notNull(),
    pageId: text("page_id")
      .notNull()
      .unique()
      .references(() => pages.id, { onDelete: "cascade" }),
    sourceParentNodeId: text("source_parent_node_id"),
    // "document" | "tab"
    sourceKind: text("source_kind").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    // "active" | "archived"
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.sourceNodeId] })],
);

export const googleDocumentImportJobs = sqliteTable("google_document_import_jobs", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().unique(),
  requestedBy: text("requested_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // "queued" | "running" | "completed" | "failed"
  status: text("status").notNull().default("queued"),
  totalNodes: integer("total_nodes").notNull().default(0),
  completedNodes: integer("completed_nodes").notNull().default(0),
  totalImages: integer("total_images").notNull().default(0),
  completedImages: integer("completed_images").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
