import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  // Durable Workflow identity plus the access and retrieval audit records.
  // These are JSON strings because D1 has no native JSON column type.
  workflowId: text("workflow_id"),
  accessContextJson: text("access_context_json"),
  contextManifestJson: text("context_manifest_json"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
