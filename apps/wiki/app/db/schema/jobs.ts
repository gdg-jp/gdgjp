import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { spaces } from "./spaces";

// ---------------------------------------------------------------------------
// agent_jobs — queue between the Worker (producer) and the OCI runner (consumer).
// Write only through app/features/jobs/.
// ---------------------------------------------------------------------------
export const agentJobs = sqliteTable(
  "agent_jobs",
  {
    id: text("id").primaryKey(),
    // "synthesize" | "answer" | "consolidate" | "translate"
    type: text("type").notNull(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    // "queued" | "leased" | "succeeded" | "failed" | "needs_review" | "expired"
    status: text("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    payload: text("payload").notNull().default("{}"),
    result: text("result"),
    error: text("error"),
    leaseOwner: text("lease_owner"),
    leaseUntil: integer("lease_until", { mode: "timestamp" }),
    attempts: integer("attempts").notNull().default(0),
    runAfter: integer("run_after", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    deadlineAt: integer("deadline_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    startedAt: integer("started_at", { mode: "timestamp" }),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
  },
  (t) => [
    index("idx_agent_jobs_queue").on(t.status, t.priority, t.runAfter, t.createdAt),
    index("idx_agent_jobs_space").on(t.spaceId, t.type, t.status),
  ],
);
