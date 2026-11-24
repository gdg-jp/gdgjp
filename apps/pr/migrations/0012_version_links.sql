-- A short link belongs to one approved draft version (draft_id, draft_version) and is created
-- only after that version's approval is recorded; a send looks it up by the version it sends.
-- Links stored before this migration were made per schedule item, before the approval was
-- checked, so they may point at another version's target. They stay for health checks and
-- metrics but are bound only where a sent target shows which version went out with them.
ALTER TABLE campaign_links ADD COLUMN draft_id INTEGER;
ALTER TABLE campaign_links ADD COLUMN draft_version INTEGER;
CREATE UNIQUE INDEX campaign_links_version ON campaign_links (draft_id, draft_version);

UPDATE campaign_links
SET draft_id = (
    SELECT d.id FROM drafts d
    WHERE d.schedule_item_id = campaign_links.schedule_item_id AND d.status != 'superseded'
    ORDER BY d.id DESC LIMIT 1
  ),
  draft_version = (
    SELECT MAX(t.approved_version) FROM dispatch_targets t
    WHERE t.schedule_item_id = campaign_links.schedule_item_id
      AND t.status IN ('dispatching', 'scheduled')
  )
WHERE schedule_item_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM dispatch_targets t
    WHERE t.schedule_item_id = campaign_links.schedule_item_id
      AND t.status IN ('dispatching', 'scheduled') AND t.approved_version IS NOT NULL
  );

UPDATE campaign_links SET draft_id = NULL WHERE draft_version IS NULL;
