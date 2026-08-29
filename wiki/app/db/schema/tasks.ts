import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { pages } from "./pages";
import { user } from "./user";

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
