import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
