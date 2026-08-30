CREATE TABLE translation_jobs (
  page_id         TEXT PRIMARY KEY NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed')),
  source_hash     TEXT,
  requested_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at      INTEGER,
  completed_at    INTEGER,
  lease_until     INTEGER,
  next_attempt_at INTEGER,
  attempts        INTEGER NOT NULL DEFAULT 0,
  cache_hits      INTEGER NOT NULL DEFAULT 0,
  cache_misses    INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT
);

CREATE INDEX translation_jobs_dispatch
  ON translation_jobs(status, next_attempt_at, requested_at);

CREATE TABLE translation_segments (
  cache_key       TEXT PRIMARY KEY NOT NULL,
  translated_text TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  format_version  TEXT NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Every write path (UI, CLI sync, imports, agents) converges on these triggers.
CREATE TRIGGER pages_translation_insert
AFTER INSERT ON pages
WHEN NEW.translation_status_en <> 'human'
  AND length(trim(NEW.title_ja || NEW.summary_ja || NEW.content_ja)) > 0
BEGIN
  INSERT INTO translation_jobs(page_id, status, requested_at)
  VALUES (NEW.id, 'pending', unixepoch())
  ON CONFLICT(page_id) DO UPDATE SET
    status = 'pending', source_hash = NULL, requested_at = unixepoch(),
    started_at = NULL, completed_at = NULL, lease_until = NULL,
    next_attempt_at = NULL, attempts = 0, last_error = NULL;
END;

CREATE TRIGGER pages_translation_ja_update
AFTER UPDATE OF title_ja, summary_ja, content_ja ON pages
WHEN NEW.translation_status_en <> 'human'
  AND (NEW.title_ja IS NOT OLD.title_ja
    OR NEW.summary_ja IS NOT OLD.summary_ja
    OR NEW.content_ja IS NOT OLD.content_ja)
  AND length(trim(NEW.title_ja || NEW.summary_ja || NEW.content_ja)) > 0
BEGIN
  UPDATE pages SET translation_status_en = 'missing'
    WHERE id = NEW.id AND translation_status_en <> 'missing';
  INSERT INTO translation_jobs(page_id, status, requested_at)
  VALUES (NEW.id, 'pending', unixepoch())
  ON CONFLICT(page_id) DO UPDATE SET
    status = 'pending', source_hash = NULL, requested_at = unixepoch(),
    started_at = NULL, completed_at = NULL, lease_until = NULL,
    next_attempt_at = NULL, attempts = 0, last_error = NULL;
END;

CREATE TRIGGER pages_translation_missing_update
AFTER UPDATE OF translation_status_en ON pages
WHEN NEW.translation_status_en = 'missing'
  AND OLD.translation_status_en <> 'missing'
  AND length(trim(NEW.title_ja || NEW.summary_ja || NEW.content_ja)) > 0
BEGIN
  INSERT INTO translation_jobs(page_id, status, requested_at)
  VALUES (NEW.id, 'pending', unixepoch())
  ON CONFLICT(page_id) DO UPDATE SET
    status = 'pending', source_hash = NULL, requested_at = unixepoch(),
    started_at = NULL, completed_at = NULL, lease_until = NULL,
    next_attempt_at = NULL, attempts = 0, last_error = NULL;
END;

CREATE TRIGGER pages_translation_human_update
AFTER UPDATE OF translation_status_en ON pages
WHEN NEW.translation_status_en = 'human'
  AND OLD.translation_status_en <> 'human'
BEGIN
  UPDATE translation_jobs SET
    status = 'completed', completed_at = unixepoch(), lease_until = NULL,
    next_attempt_at = NULL, last_error = NULL
  WHERE page_id = NEW.id;
END;

-- Resume only pages that do not already have a usable English translation.
INSERT INTO translation_jobs(page_id, status, requested_at)
SELECT id, 'pending', unixepoch()
FROM pages
WHERE translation_status_en = 'missing'
  AND length(trim(title_ja || summary_ja || content_ja)) > 0
ON CONFLICT(page_id) DO NOTHING;
