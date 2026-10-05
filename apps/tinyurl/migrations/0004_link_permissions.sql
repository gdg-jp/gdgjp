CREATE TABLE link_permissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id        INTEGER NOT NULL,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'chapter')),
  principal_id   TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(link_id, principal_type, principal_id),
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);

CREATE INDEX idx_link_permissions_link
  ON link_permissions(link_id);
CREATE INDEX idx_link_permissions_user
  ON link_permissions(principal_type, principal_id) WHERE principal_type = 'user';
CREATE INDEX idx_link_permissions_chapter
  ON link_permissions(principal_type, principal_id) WHERE principal_type = 'chapter';
