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
