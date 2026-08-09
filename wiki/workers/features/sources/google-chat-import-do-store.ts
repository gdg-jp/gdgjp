/**
 * SQLite tables inside GoogleChatImportDurableObject storage.
 * Object-local: reads/writes do not consume the Workers subrequest budget.
 */
export function ensureChatImportDoSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      page_index INTEGER PRIMARY KEY,
      r2_key TEXT NOT NULL,
      message_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS senders (
      resource_name TEXT PRIMARY KEY,
      display_name TEXT
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
    CREATE TABLE IF NOT EXISTS months (
      month_path TEXT PRIMARY KEY,
      r2_key TEXT NOT NULL,
      sort_index INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS month_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_path TEXT NOT NULL,
      message_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export type ChatImportDoSql = SqlStorage;
