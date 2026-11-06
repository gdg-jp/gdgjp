import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";

const D1_MAX_BOUND_PARAMETERS = 100;

/**
 * Real SQLite from the generated schema dump plus the rows migration 0062 seeds (the dump
 * carries schema only). Space access is decided entirely in SQL predicates, so tests run
 * them instead of mocking the query builder.
 */
export function createSpacesTestDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(new URL("../../../schema.sql", import.meta.url), "utf8").replace(
      /^CREATE TABLE IF NOT EXISTS 'pages_fts[^']+'.*;\n/gm,
      "",
    ),
  );
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(`
    INSERT INTO user (id, name, email, created_at, updated_at) VALUES
      ('admin', 'Admin', 'admin@example.com', 0, 0),
      ('alice', 'Alice', 'alice@example.com', 0, 0),
      ('bob', 'Bob', 'bob@example.com', 0, 0);
    INSERT INTO spaces (id, slug, name, kind) VALUES ('gdg-jp', 'gdg-jp', 'GDG Japan', 'shared');
    INSERT INTO space_members (space_id, principal_type, principal_id, role) VALUES
      ('gdg-jp', 'public', '*', 'viewer'),
      ('gdg-jp', 'user', '*', 'editor');
  `);
  const execute = async (sql: string, params: unknown[], method: string) => {
    // D1 rejects a statement with more than 100 bound parameters; local SQLite does not.
    if (params.length > D1_MAX_BOUND_PARAMETERS) {
      throw new Error(`too many SQL variables: ${params.length} > ${D1_MAX_BOUND_PARAMETERS}`);
    }
    const statement = sqlite.prepare(sql);
    if (method === "run") {
      const result = statement.run(...(params as never[]));
      return { rows: [], meta: { changes: result.changes } };
    }
    const rows = statement.all(...(params as never[])).map((row) => Object.values(row));
    if (method === "get") return { rows: rows[0] as unknown[] } as { rows: unknown[] };
    return { rows };
  };
  const db = drizzle(
    execute,
    async (batch) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const query of batch)
          results.push(await execute(query.sql, query.params, query.method));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    { schema },
  );
  return { db: db as unknown as ReturnType<typeof getDb>, sqlite };
}
