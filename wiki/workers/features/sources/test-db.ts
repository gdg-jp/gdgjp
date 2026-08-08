import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "../../../app/db/schema";

/**
 * A real SQLite database driven through Drizzle's proxy driver, seeded from the
 * checked-in migration.
 *
 * The source lifecycle rules this exercises live entirely in WHERE clauses — "only
 * finish if the row is still fetching", "archive the paths this fetch did not return".
 * Mocking the query builder would assert that we wrote the code we wrote; running the
 * statements asserts they select the rows we meant.
 */
export function createSourcesTestDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE "user" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "chapters" ("id" TEXT PRIMARY KEY);
    INSERT INTO "user" ("id") VALUES ('user-1');
  `);
  sqlite.exec(
    readFileSync(new URL("../../../migrations/0033_add_sources.sql", import.meta.url), "utf8"),
  );

  const db = drizzle(
    async (sql, params, method) => {
      const statement = sqlite.prepare(sql);
      if (method === "run") {
        statement.run(...(params as never[]));
        return { rows: [] };
      }
      // The proxy driver wants positional values, not column-keyed objects. For `get`
      // it wants the single row itself, and `undefined` — not `[]` — when there is none;
      // an empty array maps to an all-undefined object that reads as a real row.
      const rows = statement.all(...(params as never[])).map((row) => Object.values(row));
      if (method === "get") {
        return { rows: rows[0] as unknown[] } as { rows: unknown[] };
      }
      return { rows };
    },
    { schema },
  );

  return { db, sqlite };
}

export type SourcesTestDb = ReturnType<typeof createSourcesTestDb>;
