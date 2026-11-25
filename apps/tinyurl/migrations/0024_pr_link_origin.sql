-- A link pr.gdgs.jp creates for one approved draft version carries that origin
-- (pr_origin = 'pr:<campaign>:<draft>:<version>') and the chapter it was created for, so a
-- repeated create for the same origin returns the same link instead of a slug conflict.
-- Links made before this migration, and links made elsewhere, have no origin.
ALTER TABLE links ADD COLUMN pr_origin TEXT;
ALTER TABLE links ADD COLUMN pr_origin_chapter_id INTEGER;
CREATE UNIQUE INDEX idx_links_pr_origin ON links(pr_origin) WHERE pr_origin IS NOT NULL;
