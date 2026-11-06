import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Stage 06: nightly latency samples (freshness, integration, answer). See /admin/stats.
export const freshnessSamples = sqliteTable(
  "freshness_samples",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    spaceId: text("space_id"),
    valueSeconds: integer("value_seconds").notNull(),
    subjectId: text("subject_id"),
    sampledAt: integer("sampled_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("idx_freshness_samples_kind_time").on(t.kind, t.sampledAt)],
);
