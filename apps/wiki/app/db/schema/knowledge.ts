import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { spaces } from "./spaces";

// Items pushed into each space's AI Search instance (Stage 03). Written only by
// app/features/knowledge/mirror.server.ts.
export const knowledgeItems = sqliteTable(
  "knowledge_items",
  {
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    itemId: text("item_id"),
    // "page" | "document"
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    version: text("version").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.itemKey] }),
    index("idx_knowledge_items_subject").on(t.subjectType, t.subjectId),
  ],
);
