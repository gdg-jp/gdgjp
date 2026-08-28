/**
 * SQLite schema for one event's {@link OstBoard} Durable Object.
 *
 * Every statement is idempotent, so this runs unconditionally from the
 * constructor. There is no version counter yet (Workers SQLite rejects
 * `PRAGMA user_version` via `sql.exec`); a future migration would add a
 * `meta(key, value)` row and stepwise `ALTER TABLE`s.
 */
export function ensureOstBoardSchema(sql: SqlStorage): void {
  sql.exec(
    `CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      group_id TEXT,
      desk_id TEXT
    )`,
  );
  sql.exec("CREATE INDEX IF NOT EXISTS topics_group_idx ON topics(group_id)");
  sql.exec("CREATE INDEX IF NOT EXISTS topics_desk_idx ON topics(desk_id)");

  sql.exec(
    `CREATE TABLE IF NOT EXISTS votes (
      topic_id TEXT NOT NULL,
      voter_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (topic_id, voter_id)
    )`,
  );
  sql.exec("CREATE INDEX IF NOT EXISTS votes_topic_idx ON votes(topic_id)");

  sql.exec(
    `CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      label TEXT,
      created_at INTEGER NOT NULL
    )`,
  );

  sql.exec(
    `CREATE TABLE IF NOT EXISTS desks (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL DEFAULT 160,
      height REAL NOT NULL DEFAULT 100,
      rotation REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  );
}
