import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

const SCHEMA = new URL("../../schema.sql", import.meta.url);

function countPlaceholders(sql: string): number {
  return (sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*/g, "").match(/\?/g) ?? []).length;
}

class TestD1PreparedStatement {
  constructor(
    private readonly raw: StatementSync,
    private readonly params: readonly SQLInputValue[],
  ) {}

  bind(...params: SQLInputValue[]): TestD1PreparedStatement {
    const expected = countPlaceholders(this.raw.sourceSQL);
    if (params.length !== expected) {
      throw new Error(
        `Wrong number of parameter bindings for SQL query (expected ${expected}, got ${params.length}).`,
      );
    }
    return new TestD1PreparedStatement(this.raw, params);
  }

  async first<T>(): Promise<T | null> {
    return (this.raw.get(...this.params) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.raw.all(...this.params) as T[] };
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    return this.runSync();
  }

  runSync(): { success: true; meta: { changes: number } } {
    return { success: true, meta: { changes: Number(this.raw.run(...this.params).changes) } };
  }
}

export type TestD1 = { db: D1Database; raw: DatabaseSync };

export function createTestD1(): TestD1 {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec(readFileSync(SCHEMA, "utf8"));
  const db = {
    prepare: (sql: string) => new TestD1PreparedStatement(raw.prepare(sql), []),
    async batch(statements: TestD1PreparedStatement[]) {
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
  return { db: db as unknown as D1Database, raw };
}
