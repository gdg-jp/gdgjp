-- Flat (non-hierarchical) folders, owned by a chapter. Any member of that
-- chapter can create, rename, delete, and assign images to it. Deleting a
-- folder does not delete its images; they fall back to unfiled.
CREATE TABLE folders (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id         INTEGER NOT NULL,
  name               TEXT NOT NULL COLLATE NOCASE,
  created_by_user_id TEXT NOT NULL,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Folder names are unique within a chapter. No hierarchy, so no parent to
-- scope uniqueness by.
CREATE UNIQUE INDEX idx_folders_chapter_name ON folders(chapter_id, name);

ALTER TABLE images ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX idx_images_folder ON images(folder_id, created_at DESC);
