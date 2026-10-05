ALTER TABLE `tasks` ADD COLUMN `assignee_name` text;

CREATE TRIGGER `tasks_assignee_exclusive_insert`
BEFORE INSERT ON `tasks`
FOR EACH ROW
WHEN NEW.`assignee_id` IS NOT NULL AND NEW.`assignee_name` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'tasks: assignee_id and assignee_name cannot both be set');
END;

CREATE TRIGGER `tasks_assignee_exclusive_update`
BEFORE UPDATE ON `tasks`
FOR EACH ROW
WHEN NEW.`assignee_id` IS NOT NULL AND NEW.`assignee_name` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'tasks: assignee_id and assignee_name cannot both be set');
END;
