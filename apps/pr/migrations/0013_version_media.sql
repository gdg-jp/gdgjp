-- The image attached to a post belongs to a draft version, so changing it saves a new version
-- and needs a new approval. The image on the draft moves to the draft's current version.
-- Before this migration the image could change after approval, so no stored approval of a
-- post proves which image it approved: posts that still have something to send go back to
-- needs_approval, and their approved targets go back to pending.
ALTER TABLE draft_versions ADD COLUMN media_url TEXT;

UPDATE draft_versions
SET media_url = (SELECT d.dispatch_media_url FROM drafts d WHERE d.id = draft_versions.draft_id)
WHERE version = (SELECT d.current_version FROM drafts d WHERE d.id = draft_versions.draft_id);

UPDATE dispatch_targets
SET status = 'pending', approved_version = NULL, approved_by = NULL, approved_at = NULL,
  actor_snapshot = NULL, updated_at = unixepoch()
WHERE status = 'approved'
  AND schedule_item_id IN (
  SELECT schedule_item_id FROM drafts
  WHERE status = 'approved'
    AND kind IN ('x_post', 'live_post')
    AND schedule_item_id IS NOT NULL
  );

UPDATE schedule_items
SET status = 'needs_approval', updated_at = unixepoch()
WHERE status = 'approved'
  AND id IN (
  SELECT schedule_item_id FROM drafts
  WHERE status = 'approved'
    AND kind IN ('x_post', 'live_post')
    AND schedule_item_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM dispatch_targets t
          WHERE t.schedule_item_id = drafts.schedule_item_id
            AND t.status IN ('pending', 'approved', 'failed')
        )
        OR NOT EXISTS (
          SELECT 1 FROM dispatch_targets t WHERE t.schedule_item_id = drafts.schedule_item_id
        )
      )
  );

UPDATE drafts
SET status = 'needs_approval', approved_version = NULL, approved_by = NULL, approved_at = NULL,
  updated_at = unixepoch()
WHERE status = 'approved'
  AND kind IN ('x_post', 'live_post')
  AND (
    schedule_item_id IS NULL
    OR EXISTS (
      SELECT 1 FROM dispatch_targets t
      WHERE t.schedule_item_id = drafts.schedule_item_id
        AND t.status IN ('pending', 'approved', 'failed')
    )
    OR NOT EXISTS (
      SELECT 1 FROM dispatch_targets t WHERE t.schedule_item_id = drafts.schedule_item_id
    )
  );
