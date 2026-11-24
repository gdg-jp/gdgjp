-- The image attached to a post belongs to a draft version, so changing it saves a new version
-- and needs a new approval. The image on the draft moves to the draft's current version.
ALTER TABLE draft_versions ADD COLUMN media_url TEXT;

UPDATE draft_versions
SET media_url = (SELECT d.dispatch_media_url FROM drafts d WHERE d.id = draft_versions.draft_id)
WHERE version = (SELECT d.current_version FROM drafts d WHERE d.id = draft_versions.draft_id);
