-- Rebuild the user table with only the columns we actually use after migrating
-- off better-auth. Drops emailVerified (Google always returns verified) and
-- moves to snake_case + integer epochs for parity with the rest of the schema.
--
-- IMPORTANT: foreign keys are disabled for the duration of this migration.
-- Without this, `DROP TABLE "user"` would cascade-delete every row in tables
-- that reference user(id) ON DELETE CASCADE before we rename the new table
-- into place — wiping user-owned data.
PRAGMA foreign_keys = OFF;

CREATE TABLE user_new (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  image        TEXT,
  is_admin     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO user_new (id, email, name, image, is_admin, created_at, updated_at)
SELECT
  id,
  email,
  name,
  image,
  0,
  CAST(strftime('%s', createdAt) AS INTEGER),
  CAST(strftime('%s', updatedAt) AS INTEGER)
FROM "user";

DROP TABLE "user";
ALTER TABLE user_new RENAME TO "user";

PRAGMA foreign_keys = ON;
