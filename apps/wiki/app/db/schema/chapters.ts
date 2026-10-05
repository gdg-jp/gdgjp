import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
