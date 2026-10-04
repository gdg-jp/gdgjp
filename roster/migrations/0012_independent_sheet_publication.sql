-- Recruitment status and sheet publication are independent after creation.
-- Preserve every existing sheet's visibility. The event INSERT trigger still
-- initializes default-sheet visibility for legacy imports/creation, and the
-- 0007/0011 backfills retain their compatibility behavior.
DROP TRIGGER events_sync_default_roster_sheet_visibility;
