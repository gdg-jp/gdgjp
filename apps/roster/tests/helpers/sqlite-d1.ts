import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";

function countPlaceholders(sql: string): number {
  return (sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*/g, "").match(/\?/g) ?? []).length;
}

class TestD1PreparedStatement {
  constructor(
    private readonly raw: StatementSync,
    private readonly params: readonly unknown[],
  ) {}

  bind(...params: unknown[]): TestD1PreparedStatement {
    // node:sqlite binds missing parameters as NULL; D1 rejects the query instead, so mirror D1
    // here or a short `.bind()` passes every unit test and only fails against real D1.
    const expected = countPlaceholders(this.raw.sourceSQL);
    if (params.length !== expected) {
      throw new Error(
        `Wrong number of parameter bindings for SQL query (expected ${expected}, got ${params.length}).`,
      );
    }
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
