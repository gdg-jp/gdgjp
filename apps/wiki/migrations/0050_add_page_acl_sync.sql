ALTER TABLE pages ADD COLUMN acl_synced_with_parent INTEGER NOT NULL DEFAULT 1;

-- Existing child pages only opt into propagation when their effective ACL data
-- already matches their direct parent. Row identity/audit metadata is not ACL.
UPDATE pages AS child
SET acl_synced_with_parent = CASE
  WHEN child.parent_id IS NULL THEN 1
  WHEN EXISTS (
    SELECT 1 FROM pages AS parent
    WHERE parent.id = child.parent_id
      AND (
        parent.visibility != child.visibility
        OR parent.general_role != child.general_role
        OR EXISTS (
          SELECT 1 FROM page_access AS child_access
          WHERE child_access.page_id = child.id
            AND NOT EXISTS (
              SELECT 1 FROM page_access AS parent_access
              WHERE parent_access.page_id = parent.id
                AND parent_access.subject_type = child_access.subject_type
                AND parent_access.subject_key = child_access.subject_key
                AND parent_access.role = child_access.role
            )
        )
        OR EXISTS (
          SELECT 1 FROM page_access AS parent_access
          WHERE parent_access.page_id = parent.id
            AND NOT EXISTS (
              SELECT 1 FROM page_access AS child_access
              WHERE child_access.page_id = child.id
                AND child_access.subject_type = parent_access.subject_type
                AND child_access.subject_key = parent_access.subject_key
                AND child_access.role = parent_access.role
            )
        )
      )
  ) THEN 0
  ELSE 1
END;

CREATE INDEX IF NOT EXISTS idx_pages_parent_acl_sync
  ON pages (parent_id, acl_synced_with_parent);
