-- An approval names the draft version it approves. A send goes out only when the draft's
-- approval and the target's approval name the same version and that version is still the
-- latest. Approvals stored before this migration name no version, so they cannot send: drafts
-- that still have something to send go back to needs_approval, and their approved targets go
-- back to pending, to be approved again by version.
ALTER TABLE drafts ADD COLUMN approved_version INTEGER;
ALTER TABLE dispatch_targets ADD COLUMN approved_version INTEGER;

UPDATE drafts
SET status = 'needs_approval', approved_by = NULL, approved_at = NULL, updated_at = unixepoch()
WHERE status = 'approved'
  AND kind IN ('x_post', 'live_post', 'connpass_mail')
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
  );

UPDATE dispatch_targets
SET status = 'pending', approved_by = NULL, approved_at = NULL, actor_snapshot = NULL,
  updated_at = unixepoch()
WHERE status = 'approved';

UPDATE schedule_items
SET status = 'needs_approval', updated_at = unixepoch()
WHERE status = 'approved'
  AND id IN (
    SELECT schedule_item_id FROM drafts
    WHERE status = 'needs_approval' AND kind IN ('x_post', 'live_post', 'connpass_mail')
  );
