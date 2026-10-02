import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";

/**
 * A real SQLite database (Node's built-in `node:sqlite`, already used the
 * same way in `wiki/workers/features/sources/test-db.ts`) wrapped just
 * enough to satisfy the slice of the `D1Database` surface this app's
 * `*.server.ts` modules call: `prepare().bind().first()/all()/run()` and
 * `batch()`.
 *
 * roster has no ORM (docs/roster/adr.md ADR-001) and no real D1 binding
 * wired into vitest (see `app/features/events/events.server.test.ts`'s doc
 * comment), so a hand-mocked `D1Database` would only prove the code calls
 * `.prepare()` — never that the SQL text is correct. Running it against a
 * real SQLite engine, migrated from the actual `migrations/*.sql` files,
 * catches what a mock can't: UNIQUE/CHECK/FK constraint behavior, which is
 * exactly what Stage 04's two-UNIQUE-index dedup design
 * (docs/roster/index.md §4) depends on.
 */

class TestD1PreparedStatement {
  constructor(
    private readonly raw: StatementSync,
    private readonly params: readonly unknown[],
  ) {}

  bind(...params: unknown[]): TestD1PreparedStatement {
    return new TestD1PreparedStatement(this.raw, params);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.raw.get(...(this.params as never[]));
    return (row as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rows = this.raw.all(...(this.params as never[])) as T[];
    return { results: rows };
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    return this.runSync();
  }

  runSync(): { success: true; meta: { changes: number } } {
    const result = this.raw.run(...(this.params as never[]));
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

export type TestD1Database = {
  prepare(sql: string): TestD1PreparedStatement;
  batch<T = unknown>(
    statements: TestD1PreparedStatement[],
  ): Promise<Array<{ success: true; meta: { changes: number } }>>;
};

/**
 * Applies `migrationFiles` (absolute paths, in order) to a fresh in-memory
 * database and returns a handle usable anywhere a `D1Database` is expected
 * — cast at the call site with `asD1()`, since this only implements the
 * methods `app/features/**\/*.server.ts` actually calls, not the full
 * Cloudflare `D1Database` interface (no `.dump()`, `.exec()`, etc.).
 */
export function createTestD1(migrationFiles: readonly string[]): TestD1Database {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  for (const file of migrationFiles) {
    raw.exec(readFileSync(file, "utf8"));
  }

  return {
    prepare(sql: string) {
      return new TestD1PreparedStatement(raw.prepare(sql), []);
    },
    async batch(statements) {
      if (!statements.every((statement) => typeof statement.runSync === "function")) {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
      }
      raw.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.runSync());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export function asD1(db: TestD1Database): D1Database {
  return db as unknown as D1Database;
}
