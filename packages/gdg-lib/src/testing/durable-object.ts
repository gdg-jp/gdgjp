import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { deserialize, serialize } from "node:v8";
import type { SnapshotSqlValue } from "../staging-snapshot";

type Row = SnapshotSqlValue[];

type Statement = StatementSync & {
  columns(): { name: string }[];
  setReturnArrays(enabled: boolean): void;
};

function cursor(columnNames: string[], rows: Row[]) {
  const records = () =>
    rows.map((row) => Object.fromEntries(columnNames.map((name, index) => [name, row[index]])));
  return {
    columnNames,
    toArray: records,
    one: () => {
      const [first, ...rest] = records();
      if (!first || rest.length) throw new Error(`Expected exactly one row, got ${rows.length}`);
      return first;
    },
    raw: () => rows[Symbol.iterator](),
    [Symbol.iterator]: () => records()[Symbol.iterator](),
  };
}

function fromSqlite(value: unknown): SnapshotSqlValue {
  if (value instanceof Uint8Array)
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  if (typeof value === "bigint") return Number(value);
  return value as SnapshotSqlValue;
}

function toSqlite(value: unknown): SQLInputValue {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value as SQLInputValue;
}

export class FakeDurableObjectStorage {
  readonly db = new DatabaseSync(":memory:");
  private alarm: number | null = null;

  constructor() {
    this.db.exec('CREATE TABLE "_cf_KV" (key TEXT PRIMARY KEY, value BLOB)');
  }

  readonly sql = {
    exec: (query: string, ...bindings: unknown[]) => this.exec(query, bindings),
  };

  readonly kv = {
    get: <T>(key: string): T | undefined => this.read(key) as T | undefined,
    put: (key: string, value: unknown) => this.write(key, value),
    delete: (key: string) => this.remove(key),
  };

  private exec(query: string, bindings: unknown[]) {
    if (/\b(?:FROM|INTO|UPDATE|TABLE)\s+["'`]?_cf_/i.test(query))
      throw new Error("not authorized: SQLITE_AUTH");
    const body = query.trim().replace(/;\s*$/, "");
    if (body.includes(";")) {
      if (bindings.length) throw new Error("Bindings need a single statement");
      this.db.exec(query);
      return cursor([], []);
    }
    const statement = this.db.prepare(body) as Statement;
    const columns = statement.columns().map(({ name }) => name);
    const values = bindings.map(toSqlite);
    if (!columns.length) {
      statement.run(...values);
      return cursor([], []);
    }
    statement.setReturnArrays(true);
    const rows = (statement.all(...values) as unknown as unknown[][]).map((row) =>
      row.map(fromSqlite),
    );
    return cursor(columns, rows);
  }

  private read(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM "_cf_KV" WHERE key = ?').get(key) as
      | { value: Uint8Array }
      | undefined;
    return row ? deserialize(row.value) : undefined;
  }

  private write(key: string, value: unknown): void {
    this.db
      .prepare('INSERT OR REPLACE INTO "_cf_KV" (key, value) VALUES (?, ?)')
      .run(key, serialize(value));
  }

  private remove(key: string): boolean {
    return this.db.prepare('DELETE FROM "_cf_KV" WHERE key = ?').run(key).changes > 0;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.read(key) as T | undefined;
  }

  async put(key: string | Record<string, unknown>, value?: unknown): Promise<void> {
    if (typeof key === "string") this.write(key, value);
    else for (const [entry, entryValue] of Object.entries(key)) this.write(entry, entryValue);
  }

  async delete(key: string): Promise<boolean> {
    return this.remove(key);
  }

  async list(): Promise<Map<string, unknown>> {
    const rows = this.db.prepare('SELECT key, value FROM "_cf_KV" ORDER BY key').all() as {
      key: string;
      value: Uint8Array;
    }[];
    return new Map(rows.map(({ key, value }) => [key, deserialize(value)]));
  }

  async deleteAll(): Promise<void> {
    const objects = this.db
      .prepare(
        "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name <> '_cf_KV'",
      )
      .all() as { type: string; name: string }[];
    this.db.exec("PRAGMA foreign_keys = OFF");
    for (const { type, name } of objects)
      this.db.exec(`DROP ${type === "view" ? "VIEW" : "TABLE"} "${name.replaceAll('"', '""')}"`);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec('DELETE FROM "_cf_KV"');
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async setAlarm(time: number | Date): Promise<void> {
    this.alarm = typeof time === "number" ? time : time.getTime();
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }

  transactionSync<T>(closure: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = closure();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function fakeDurableObjectState(storage = new FakeDurableObjectStorage()) {
  return {
    storage,
    getWebSockets: (): WebSocket[] => [],
    acceptWebSocket: () => {},
    setWebSocketAutoResponse: () => {},
    waitUntil: () => {},
    blockConcurrencyWhile: async <T>(closure: () => Promise<T>): Promise<T> => closure(),
  };
}

export const cloudflareWorkersModule = {
  DurableObject: class<Env = unknown> {
    constructor(
      protected ctx: unknown,
      protected env: Env,
    ) {}
  },
  WorkerEntrypoint: class<Env = unknown> {
    constructor(
      protected ctx: unknown,
      protected env: Env,
    ) {}
  },
  WorkflowEntrypoint: class {},
};

export function rpcStub<T extends object>(target: T): T {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) =>
        structuredClone(await value.apply(object, structuredClone(args)));
    },
  });
}

export function fakeNamespace<T extends object>(create: (name: string) => T) {
  const instances = new Map<string, T>();
  const getByName = (name: string): T => {
    let instance = instances.get(name);
    if (!instance) {
      instance = create(name);
      instances.set(name, instance);
    }
    return rpcStub(instance);
  };
  return {
    instances,
    getByName,
    idFromName: (name: string) => name,
    get: (id: string) => getByName(id),
  };
}
