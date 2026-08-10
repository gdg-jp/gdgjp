/**
 * SQLite tables inside SourceImportDurableObject storage.
 * Object-local: reads/writes do not consume the Workers subrequest budget.
 */
export function ensureSourceImportDoSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      page_index INTEGER PRIMARY KEY,
      r2_key TEXT NOT NULL,
      message_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS senders (
      resource_name TEXT PRIMARY KEY,
      display_name TEXT,
      lookup_done INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_name TEXT NOT NULL,
      object_id TEXT NOT NULL,
      drive_file_id TEXT,
      media_resource_name TEXT,
      content_type TEXT,
      content_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      asset_json TEXT
    );
    CREATE TABLE IF NOT EXISTS thread_parents (
      thread_name TEXT PRIMARY KEY,
      parent_text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reply_threads (
      thread_name TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS week_documents (
      week_path TEXT PRIMARY KEY,
      r2_key TEXT NOT NULL,
      sort_index INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS week_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_path TEXT NOT NULL,
      thread_name TEXT NOT NULL,
      create_time TEXT NOT NULL,
      message_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS touched_weeks (
      week_path TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS drive_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_kind TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      gid TEXT,
      media_type TEXT NOT NULL,
      body_r2_key TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      sort_index INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drive_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_id INTEGER NOT NULL REFERENCES drive_units(id) ON DELETE CASCADE,
      object_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      content_type TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      asset_json TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS drive_units_sort_index_unique
      ON drive_units(sort_index);
    CREATE UNIQUE INDEX IF NOT EXISTS drive_images_unit_object_unique
      ON drive_images(unit_id, object_id);
    CREATE UNIQUE INDEX IF NOT EXISTS attachments_message_object_unique
      ON attachments(message_name, object_id);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // This helper runs on every tick of every import kind, so probe before altering rather than
  // relying on a thrown "duplicate column" error. Only reachable for a run that was already in
  // flight when this column shipped; start() recreates the schema from scratch.
  const hasLookupDone = sql
    .exec<{ name: string }>("PRAGMA table_info(senders)")
    .toArray()
    .some((column) => column.name === "lookup_done");
  if (!hasLookupDone) {
    sql.exec("ALTER TABLE senders ADD COLUMN lookup_done INTEGER NOT NULL DEFAULT 0");
  }
}
