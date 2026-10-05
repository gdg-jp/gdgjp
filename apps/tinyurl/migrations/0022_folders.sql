CREATE TABLE folders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL COLLATE NOCASE,
  owner_user_id    TEXT NOT NULL,
  parent_folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Folder names need only be unique among their siblings.  Folder ids start at
-- one, so zero is a safe sentinel for the root level in this expression index.
CREATE UNIQUE INDEX idx_folders_owner_parent_name
  ON folders(owner_user_id, COALESCE(parent_folder_id, 0), name);
CREATE INDEX idx_folders_parent
  ON folders(parent_folder_id, name);

CREATE TABLE folder_permissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id      INTEGER NOT NULL,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'chapter')),
  principal_id   TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(folder_id, principal_type, principal_id),
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
);
CREATE INDEX idx_folder_permissions_folder ON folder_permissions(folder_id);
CREATE INDEX idx_folder_permissions_user
  ON folder_permissions(principal_type, principal_id) WHERE principal_type = 'user';
CREATE INDEX idx_folder_permissions_chapter
  ON folder_permissions(principal_type, principal_id) WHERE principal_type = 'chapter';

ALTER TABLE links ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX idx_links_folder
  ON links(folder_id, archived_at, deleted_at, created_at DESC);
