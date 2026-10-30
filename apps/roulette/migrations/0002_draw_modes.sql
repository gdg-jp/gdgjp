-- Draw modes. The mode is derived, not stored (see projects.server.ts):
-- method 'fixed' is the custom mode, 'box' the standard mode, or the evil mode
-- when a prize is `excluded` — shown to visitors but never drawn. 'equal' is no
-- longer offered and becomes the standard mode.
ALTER TABLE prize ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0;

UPDATE project SET method = 'box' WHERE method = 'equal';

-- The admin draw log lists a project's latest spins first.
CREATE INDEX draw_number_idx ON draw (project_slug, number);
