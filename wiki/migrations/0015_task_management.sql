-- task_lists: metadata extension for pages with pageType="task-list"
CREATE TABLE IF NOT EXISTS `task_lists` (
  `page_id` text PRIMARY KEY NOT NULL,
  `next_task_number` integer NOT NULL DEFAULT 1,
  FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON DELETE CASCADE
);

-- task_list_teams: teams defined per task list
CREATE TABLE IF NOT EXISTS `task_list_teams` (
  `id` text PRIMARY KEY NOT NULL,
  `task_list_id` text NOT NULL,
  `name` text NOT NULL,
  `color` text DEFAULT '#6b7280',
  `sort_order` integer DEFAULT 0,
  FOREIGN KEY (`task_list_id`) REFERENCES `task_lists`(`page_id`) ON DELETE CASCADE
);

-- tasks: individual task items
CREATE TABLE IF NOT EXISTS `tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `task_list_id` text NOT NULL,
  `number` integer NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'todo',
  `type` text NOT NULL DEFAULT 'task',
  `due_date` text,
  `assignee_id` text,
  `team_id` text,
  `created_by` text NOT NULL,
  `sort_order` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL DEFAULT (unixepoch()),
  `updated_at` integer NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (`task_list_id`) REFERENCES `task_lists`(`page_id`) ON DELETE CASCADE,
  FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`team_id`) REFERENCES `task_list_teams`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

-- task_dependencies: junction table for task ordering constraints
CREATE TABLE IF NOT EXISTS `task_dependencies` (
  `task_id` text NOT NULL,
  `depends_on_task_id` text NOT NULL,
  PRIMARY KEY (`task_id`, `depends_on_task_id`),
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`depends_on_task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
  CHECK (`task_id` <> `depends_on_task_id`)
);

-- Indexes for tasks table
CREATE INDEX IF NOT EXISTS `idx_tasks_task_list_id` ON `tasks` (`task_list_id`);
CREATE INDEX IF NOT EXISTS `idx_tasks_assignee_id` ON `tasks` (`assignee_id`);
CREATE INDEX IF NOT EXISTS `idx_tasks_status` ON `tasks` (`task_list_id`, `status`);
CREATE INDEX IF NOT EXISTS `idx_tasks_due_date` ON `tasks` (`task_list_id`, `due_date`);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_tasks_number` ON `tasks` (`task_list_id`, `number`);
