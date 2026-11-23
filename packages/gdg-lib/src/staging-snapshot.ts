export type SnapshotSqlValue = ArrayBuffer | string | number | null;

export type SnapshotTable = {
  name: string;
  sql: string;
  columns: string[];
  rows: SnapshotSqlValue[][];
};

export type SnapshotSchemaObject = {
  type: "index" | "trigger" | "view";
  name: string;
  sql: string;
};

export type DurableObjectSnapshot = {
  kv: [string, unknown][];
  tables: SnapshotTable[];
  schema: SnapshotSchemaObject[];
  alarm: number | null;
};

export type StagingSnapshotInstance = { binding: string; name: string };

export interface StagingSnapshotService {
  instances(): Promise<StagingSnapshotInstance[]>;
  exportInstance(binding: string, name: string): Promise<DurableObjectSnapshot>;
  importInstance(binding: string, name: string, snapshot: DurableObjectSnapshot): Promise<void>;
}

export interface StagingSnapshotTarget {
  exportStagingSnapshot(): Promise<DurableObjectSnapshot>;
  importStagingSnapshot(snapshot: DurableObjectSnapshot): Promise<void>;
}

type SnapshotCursor = {
  columnNames: string[];
  toArray(): Record<string, unknown>[];
  raw(): Iterable<unknown[]>;
};

export interface SnapshotStorage {
  list(): Promise<Map<string, unknown>>;
  put(entries: Record<string, unknown>): Promise<void>;
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  transactionSync<T>(closure: () => T): T;
  sql: { exec(query: string, ...bindings: unknown[]): SnapshotCursor };
}

const KV_PUT_BATCH = 128;
const SCHEMA_TYPES = new Set(["index", "trigger", "view"]);

export function assertStagingSlot(env: { STAGING_SLOT?: unknown }): string {
  const slot = env.STAGING_SLOT;
  if (typeof slot !== "string" || !slot.trim())
    throw new Error("Durable Object snapshots can only be imported into a staging slot");
  return slot;
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function isInternal(name: string): boolean {
  return name.startsWith("_cf_") || name.startsWith("sqlite_");
}

export async function exportDurableObjectStorage(
  storage: SnapshotStorage,
): Promise<DurableObjectSnapshot> {
  const objects = storage.sql
    .exec("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL")
    .toArray()
    .map((row) => ({ type: String(row.type), name: String(row.name), sql: String(row.sql) }))
    .filter(({ name }) => !isInternal(name));
  const virtual = objects.find(
    ({ type, sql }) => type === "table" && /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql),
  );
  if (virtual) throw new Error(`Virtual table ${virtual.name} cannot be snapshotted`);
  const tables = objects
    .filter(({ type }) => type === "table")
    .map(({ name, sql }) => {
      const cursor = storage.sql.exec(`SELECT * FROM ${quoteIdentifier(name)}`);
      const rows = [...cursor.raw()] as SnapshotSqlValue[][];
      return { name, sql, columns: [...cursor.columnNames], rows };
    });
  const schema = objects
    .filter((object): object is SnapshotSchemaObject => SCHEMA_TYPES.has(object.type))
    .map(({ type, name, sql }) => ({ type, name, sql }));
  return {
    kv: [...(await storage.list()).entries()],
    tables,
    schema,
    alarm: await storage.getAlarm(),
  };
}

export async function importDurableObjectStorage(
  storage: SnapshotStorage,
  snapshot: DurableObjectSnapshot,
): Promise<void> {
  await storage.deleteAlarm();
  await storage.deleteAll();
  storage.transactionSync(() => {
    storage.sql.exec("PRAGMA defer_foreign_keys = ON");
    for (const table of snapshot.tables) storage.sql.exec(table.sql);
    for (const table of snapshot.tables) {
      if (!table.rows.length) continue;
      const insert = `INSERT INTO ${quoteIdentifier(table.name)} (${table.columns
        .map(quoteIdentifier)
        .join(", ")}) VALUES (${table.columns.map(() => "?").join(", ")})`;
      for (const row of table.rows) storage.sql.exec(insert, ...row);
    }
    for (const object of snapshot.schema) storage.sql.exec(object.sql);
  });
  for (let index = 0; index < snapshot.kv.length; index += KV_PUT_BATCH)
    await storage.put(Object.fromEntries(snapshot.kv.slice(index, index + KV_PUT_BATCH)));
  if (snapshot.alarm !== null) await storage.setAlarm(snapshot.alarm);
}

const CLOSE_RESTORED = 1012;

type RestorableState = {
  storage: SnapshotStorage;
  getWebSockets(): { close(code?: number, reason?: string): void }[];
};

export async function restoreDurableObject(
  state: RestorableState,
  env: { STAGING_SLOT?: unknown },
  snapshot: DurableObjectSnapshot,
): Promise<void> {
  assertStagingSlot(env);
  await importDurableObjectStorage(state.storage, snapshot);
  for (const socket of state.getWebSockets()) {
    try {
      socket.close(CLOSE_RESTORED, "restored from a production snapshot");
    } catch {}
  }
}
