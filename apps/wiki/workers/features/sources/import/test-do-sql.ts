import { DatabaseSync } from "node:sqlite";
import { ensureSourceImportDoSchema } from "./do-store";

/**
 * SourceImportDurableObject storage for tests: a real SQLite behind the `SqlStorage` surface the
 * import steps use, with the DO schema applied.
 */
export function memorySql(seed?: (database: DatabaseSync) => void): SqlStorage {
  const sqliteDb = new DatabaseSync(":memory:");
  const api = {
    exec<T extends Record<string, SqlStorageValue>>(query: string, ...binds: unknown[]) {
      const trimmed = query.trim().toUpperCase();
      if (
        trimmed.startsWith("SELECT") ||
        trimmed.startsWith("WITH") ||
        trimmed.startsWith("PRAGMA")
      ) {
        const rows = sqliteDb.prepare(query).all(...(binds as never[])) as T[];
        return {
          toArray: () => rows,
          one: () => {
            if (rows.length !== 1) throw new Error(`Expected 1 row, got ${rows.length}`);
            return rows[0] as T;
          },
          raw: () => rows.map((row) => Object.values(row)),
          columnNames: rows[0] ? Object.keys(rows[0]) : [],
          rowsWritten: 0,
          rowsRead: rows.length,
          [Symbol.iterator]: function* () {
            yield* rows;
          },
        };
      }
      // Multi-statement schema bootstrap from ensureSourceImportDoSchema.
      if (query.includes("CREATE TABLE")) {
        sqliteDb.exec(query);
        return {
          toArray: () => [] as T[],
          one: () => {
            throw new Error("no rows");
          },
          raw: () => [],
          columnNames: [],
          rowsWritten: 0,
          rowsRead: 0,
          [Symbol.iterator]: function* () {},
        };
      }
      const result = sqliteDb.prepare(query).run(...(binds as never[]));
      return {
        toArray: () => [] as T[],
        one: () => {
          throw new Error("no rows");
        },
        raw: () => [],
        columnNames: [],
        rowsWritten: result.changes,
        rowsRead: 0,
        [Symbol.iterator]: function* () {},
      };
    },
    get databaseSize() {
      return 0;
    },
  };
  ensureSourceImportDoSchema(api as unknown as SqlStorage);
  seed?.(sqliteDb);
  return api as unknown as SqlStorage;
}
