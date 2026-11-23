export type FakeRow = Record<string, unknown>;

export const FAKE_NOW = 2_000;

export function imageRecord(overrides: FakeRow = {}): FakeRow {
  return {
    id: "img12345",
    user_id: "owner",
    account_id: "owner",
    chapter_id: 1,
    folder_id: null,
    slug: null,
    r2_key: "img12345",
    content_type: "image/png",
    byte_size: 100,
    width: null,
    height: null,
    filename: "old.png",
    mobile_r2_key: null,
    mobile_content_type: null,
    mobile_byte_size: null,
    mobile_filename: null,
    mobile_updated_at: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

export function folderRecord(overrides: FakeRow = {}): FakeRow {
  return {
    id: 42,
    chapter_id: 2,
    name: "logos",
    created_by_user_id: "owner",
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

export function fakeImageBindings(
  options: {
    images?: FakeRow[];
    folders?: FakeRow[];
    failD1?: (sql: string) => boolean;
    failR2Put?: boolean;
  } = {},
) {
  const images = new Map((options.images ?? []).map((row) => [row.id as string, { ...row }]));
  const folders = new Map((options.folders ?? []).map((row) => [row.id as number, { ...row }]));
  const users = new Map<string, FakeRow>();
  const events: string[] = [];
  const r2Puts: { key: string; customMetadata?: Record<string, string> }[] = [];

  function write(sql: string, label: string) {
    events.push(label);
    if (options.failD1?.(sql)) throw new Error(`D1 failed: ${label}`);
  }

  function updateImage(sql: string, bound: unknown[]): FakeRow | null {
    const match = /^UPDATE images\s+SET\s+([\s\S]+?)\s+WHERE id = \?/.exec(sql);
    if (!match) throw new Error(`Unhandled UPDATE: ${sql}`);
    write(sql, "d1:update images");
    const values = [...bound];
    const id = values.pop() as string;
    const row = images.get(id);
    const patch: FakeRow = {};
    for (const assignment of match[1].split(/,\s*/)) {
      const [column, expression] = assignment.split(/\s*=\s*/);
      if (expression === "?") patch[column] = values.shift();
      else if (expression === "unixepoch()") patch[column] = FAKE_NOW;
      else if (expression === "NULL") patch[column] = null;
      else throw new Error(`Unhandled SET expression: ${assignment}`);
    }
    if (!row) return null;
    Object.assign(row, patch);
    return { ...row };
  }

  function insertImage(sql: string, bound: unknown[]) {
    const match = /^INSERT INTO images \(([^)]+)\)/.exec(sql);
    if (!match) throw new Error(`Unhandled INSERT: ${sql}`);
    write(sql, "d1:insert images");
    const columns = match[1].split(/,\s*/);
    const row = imageRecord({
      folder_id: null,
      slug: null,
      created_at: FAKE_NOW,
      updated_at: FAKE_NOW,
    });
    columns.forEach((column, index) => {
      row[column] = bound[index];
    });
    images.set(row.id as string, row);
  }

  function prepare(sql: string) {
    const text = sql.trim();
    let bound: unknown[] = [];
    const stmt = {
      bind(...values: unknown[]) {
        bound = values;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        if (text.startsWith("UPDATE images")) return updateImage(text, bound) as T | null;
        if (text.startsWith("SELECT id FROM images WHERE id = ?")) {
          return (images.has(bound[0] as string) ? { id: bound[0] } : null) as T | null;
        }
        if (/^SELECT [\s\S]+ FROM images WHERE id = \?$/.test(text)) {
          const row = images.get(bound[0] as string);
          return (row ? { ...row } : null) as T | null;
        }
        if (/^SELECT [\s\S]+ FROM folders WHERE id = \?$/.test(text)) {
          const row = folders.get(bound[0] as number);
          return (row ? { ...row } : null) as T | null;
        }
        if (text.startsWith('SELECT id FROM "user" WHERE email = ?')) {
          const user = [...users.values()].find((candidate) => candidate.email === bound[0]);
          return (user ? { id: user.id } : null) as T | null;
        }
        throw new Error(`Unhandled first() SQL: ${text}`);
      },
      async run() {
        if (text.startsWith("INSERT INTO images")) insertImage(text, bound);
        else if (text.startsWith('INSERT INTO "user"')) {
          const [id, email] = bound as string[];
          users.set(id, { id, email });
        } else if (!text.startsWith('UPDATE "user"')) {
          throw new Error(`Unhandled run() SQL: ${text}`);
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
    return stmt;
  }

  const pending: Promise<unknown>[] = [];
  const env = {
    APP_URL: "https://img.example",
    DB: { prepare },
    ORIGINALS: {
      put: async (
        key: string,
        _bytes: unknown,
        putOptions?: { customMetadata?: Record<string, string> },
      ) => {
        events.push(`r2:put ${key}`);
        if (options.failR2Put) throw new Error("R2 failed");
        r2Puts.push({ key, customMetadata: putOptions?.customMetadata });
      },
      delete: async (key: string) => {
        events.push(`r2:delete ${key}`);
      },
    },
    DERIVED: {
      list: async () => ({ objects: [], truncated: false }),
      delete: async () => {},
    },
    IMAGES: {
      info: async () => ({ format: "image/png", fileSize: 4, width: 10, height: 20 }),
    },
  } as unknown as Env;
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  } as unknown as ExecutionContext;

  return {
    env,
    ctx,
    events,
    r2Puts,
    image: (id: string) => {
      const row = images.get(id);
      return row ? { ...row } : null;
    },
    imageIds: () => [...images.keys()],
    flush: () => Promise.all(pending),
  };
}
