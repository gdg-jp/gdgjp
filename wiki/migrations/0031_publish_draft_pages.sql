-- Wiki pages are published immediately. Preserve every active page while
-- retaining the separate archived state.
UPDATE pages
SET status = 'published', updated_at = unixepoch()
WHERE status <> 'archived';
