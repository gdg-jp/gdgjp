-- A short link belongs to one approved draft version (draft_id, draft_version) and is created
-- only after that version's approval is recorded; a send looks it up by the version it sends.
-- Links stored before this migration were made per schedule item, before the approval was
-- checked, and nothing stored proves which version's destination they carry, so none is bound:
-- they stay as history for health checks and metrics, and a send creates its version's link.
ALTER TABLE campaign_links ADD COLUMN draft_id INTEGER;
ALTER TABLE campaign_links ADD COLUMN draft_version INTEGER;
CREATE UNIQUE INDEX campaign_links_version ON campaign_links (draft_id, draft_version);
