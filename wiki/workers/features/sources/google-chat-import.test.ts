import { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../app/db/schema";
import { saveChatSenderName } from "./chat-sender-registry";
import { GOOGLE_CHAT_REAUTH_MESSAGE } from "./google-chat";
import { ensureSourceImportDoSchema } from "./import/do-store";
import { createSourcesTestDb } from "./test-db";

const { db, sqlite, setAfterExecute } = createSourcesTestDb();
const start = vi.fn();

vi.mock("../../../app/lib/db.server", () => ({ getDb: () => db }));
vi.mock("../../../app/lib/google-drive-token.server", () => ({
  getGoogleDriveTokenRow: vi.fn().mockResolvedValue({
    accessToken: "token-1",
    grantedScopes: "google-chat",
  }),
}));
vi.mock("../../../app/lib/google-drive.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../app/lib/google-drive.server")>()),
  GOOGLE_DRIVE_REAUTH_MESSAGE: "Reconnect Google Drive",
  hasRequiredGoogleChatScopes: () => true,
  REQUIRED_GOOGLE_CHAT_SCOPES: ["google-chat"],
}));

import { getGoogleDriveTokenRow } from "../../../app/lib/google-drive-token.server";
import { CHAT_PAGE_SIZE, SENDERS_FLUSH_BATCH_SIZE } from "./google-chat-import";
import {
  ACCESS_TOKEN_SUBREQUESTS,
  CURRENT_RUN_SUBREQUESTS,
  type SourceImportClaimRequest,
  claimSourceImport,
  failSourceImportRun,
  startSourceImport,
} from "./import/run";
import { advanceSourceImportTick } from "./import/tick";
import { SourceAuthorizationError } from "./retry-classification";
import { SubrequestBudget } from "./subrequest-budget";

const SOURCE_ID = "chat-source-1";

function memorySql(seed?: (database: DatabaseSync) => void): SqlStorage {
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

async function source() {
  const row = await db.select().from(schema.sources).where(eq(schema.sources.id, SOURCE_ID)).get();
  if (!row) throw new Error("source fixture missing");
  return row;
}

beforeEach(() => {
  setAfterExecute(undefined);
  vi.restoreAllMocks();
  start
    .mockReset()
    .mockImplementation((request: SourceImportClaimRequest) =>
      claimSourceImport({} as Env, request).then(Boolean),
    );
  sqlite.exec("DELETE FROM source_import_runs; DELETE FROM source_documents; DELETE FROM sources;");
  sqlite.exec("DELETE FROM google_chat_sender_profiles; DELETE FROM google_chat_sender_samples;");
  sqlite
    .prepare(
      `INSERT INTO sources (id, kind, url, external_id, title, added_by, status)
       VALUES (?, 'google-chat-space', '', 'spaces/abc', 'Chat', 'user-1', 'pending')`,
    )
    .run(SOURCE_ID);
});

describe("startSourceImport with a Chat source", () => {
  it("atomically claims the source and starts the Durable Object before returning", async () => {
    const started = await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );

    const storedSource = sqlite
      .prepare("SELECT status, fetch_attempt_id FROM sources WHERE id = ?")
      .get(SOURCE_ID) as { status: string; fetch_attempt_id: string };
    const run = sqlite
      .prepare(
        "SELECT fetch_attempt_id, since_cursor, phase FROM source_import_runs WHERE source_id = ?",
      )
      .get(SOURCE_ID) as { fetch_attempt_id: string; since_cursor: string | null; phase: string };

    expect(started).toBe(true);
    expect(storedSource).toEqual({ status: "fetching", fetch_attempt_id: "attempt-1" });
    expect(run.fetch_attempt_id).toBe("attempt-1");
    expect(run.phase).toBe("listing");
    expect(run.since_cursor).toBeNull();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: SOURCE_ID, fetchAttemptId: "attempt-1" }),
    );
  });

  it("records since_cursor from existing source_documents for incremental refresh", async () => {
    sqlite
      .prepare(
        `INSERT INTO source_documents
           (id, source_id, path, title, r2_key, content_hash, captured_at, status, cursor)
         VALUES ('doc-1', ?, '2026-07', '2026-07', 'raw/x', 'hash', unixepoch(), 'ready', '2026-07-20T00:00:00Z')`,
      )
      .run(SOURCE_ID);

    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-2",
    );

    const run = sqlite
      .prepare("SELECT since_cursor FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { since_cursor: string };
    expect(run.since_cursor).toBe("2026-07-20T00:00:00Z");
  });

  it("does not reopen or start an archived source", async () => {
    sqlite.prepare("UPDATE sources SET status = 'archived' WHERE id = ?").run(SOURCE_ID);

    const started = await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );

    expect(started).toBe(false);
    expect(sqlite.prepare("SELECT status FROM sources WHERE id = ?").get(SOURCE_ID)).toEqual({
      status: "archived",
    });
    expect(
      sqlite.prepare("SELECT id FROM source_import_runs WHERE source_id = ?").get(SOURCE_ID),
    ).toBeUndefined();
    expect(start).toHaveBeenCalledOnce();
  });
});

describe("Google Chat import bounds", () => {
  it("uses a small messages.list page size to bound JSON materialization", () => {
    expect(CHAT_PAGE_SIZE).toBe(100);
  });
});
describe("advanceSourceImportTick with the Chat driver", () => {
  it("stops listing before exceeding the subrequest budget", async () => {
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };

    let listCalls = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      listCalls += 1;
      return new Response(
        JSON.stringify({
          messages: [
            { name: `spaces/abc/messages/${listCalls}`, createTime: "2026-07-01T00:00:00Z" },
          ],
          nextPageToken: "more",
        }),
      );
    });
    const objects = new Map<string, string>();
    const put = vi.fn().mockImplementation(async (key: string, body: string) => {
      objects.set(key, body);
    });
    const get = vi.fn().mockImplementation(async (key: string) => {
      const body = objects.get(key);
      return body ? { json: async () => JSON.parse(body) } : null;
    });
    // currentRun(2) + accessToken(1) + page fetch/R2 put(2) = 5; the
    // object-local page cursor leaves room for one more page in this budget.
    const budget = new SubrequestBudget(7);
    const result = await advanceSourceImportTick({
      env: { BUCKET: { put, get } } as unknown as Env,
      sql: memorySql(),
      budget,
      runId: run.id,
    });

    expect(result.finished).toBe(false);
    expect(result.phase).toBe("listing");
    expect(budget.spent).toBeLessThanOrEqual(7);
    expect(listCalls).toBe(2);
    fetchSpy.mockRestore();
  });

  it("charges every D1 / R2 / fetch call into the budget during listing", async () => {
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };

    let d1Ops = 0;
    setAfterExecute(() => {
      d1Ops += 1;
    });

    let fetchOps = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetchOps += 1;
      return new Response(
        JSON.stringify({
          messages: [{ name: "spaces/abc/messages/1", createTime: "2026-07-01T00:00:00Z" }],
          nextPageToken: "more",
        }),
      );
    });
    let r2Ops = 0;
    const put = vi.fn().mockImplementation(async () => {
      r2Ops += 1;
    });

    const budget = new SubrequestBudget(40);
    await advanceSourceImportTick({
      env: { BUCKET: { put } } as unknown as Env,
      sql: memorySql(),
      budget,
      runId: run.id,
    });

    // accessToken is mocked (no D1), so charge it explicitly as production would.
    expect(budget.spent).toBe(fetchOps + r2Ops + d1Ops + ACCESS_TOKEN_SUBREQUESTS);
    expect(d1Ops).toBeGreaterThanOrEqual(CURRENT_RUN_SUBREQUESTS);
    expect(fetchOps).toBeGreaterThan(0);
    expect(r2Ops).toBe(fetchOps);
    setAfterExecute(undefined);
    vi.restoreAllMocks();
  });

  it("does not write when the fetch lease has been replaced", async () => {
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };
    sqlite.prepare("UPDATE sources SET fetch_attempt_id = 'other' WHERE id = ?").run(SOURCE_ID);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await advanceSourceImportTick({
      env: { BUCKET: { put: vi.fn() } } as unknown as Env,
      sql: memorySql(),
      budget: new SubrequestBudget(),
      runId: run.id,
    });

    expect(result.finished).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("commits an object-local pending phase through the generic tick", async () => {
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };
    const sql = memorySql();
    sql.exec("INSERT INTO meta (key, value) VALUES ('pending_phase', 'indexing')");

    const result = await advanceSourceImportTick({
      env: {} as Env,
      sql,
      budget: new SubrequestBudget(4),
      runId: run.id,
    });

    expect(result.phase).toBe("indexing");
    expect(sql.exec("SELECT value FROM meta WHERE key = 'pending_phase'").toArray()).toEqual([]);
    expect(sqlite.prepare("SELECT phase FROM source_import_runs WHERE id = ?").get(run.id)).toEqual(
      {
        phase: "indexing",
      },
    );
  });

  it("fails missing Chat grants once with the actionable authorization error", async () => {
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };
    vi.mocked(getGoogleDriveTokenRow).mockResolvedValueOnce({
      accessToken: "token-1",
      grantedScopes: "",
    });

    const error = await advanceSourceImportTick({
      env: {} as Env,
      sql: memorySql(),
      budget: new SubrequestBudget(),
      runId: run.id,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SourceAuthorizationError);
    expect((error as Error).message).toBe(GOOGLE_CHAT_REAUTH_MESSAGE);
    await expect(failSourceImportRun({} as Env, run.id, error)).resolves.toEqual({
      retryable: false,
      consecutiveFailures: 1,
    });
  });

  it("gives unnamed messages unique per-message fallback names", async () => {
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [
            {
              createTime: "2026-07-01T00:00:00Z",
              attachment: [{ driveDataRef: { driveFileId: "a" }, contentName: "a.pdf" }],
            },
            {
              createTime: "2026-07-01T00:01:00Z",
              attachment: [{ driveDataRef: { driveFileId: "b" }, contentName: "b.pdf" }],
            },
          ],
        }),
      ),
    );
    const objects = new Map<string, string>();
    const put = vi.fn().mockImplementation(async (key: string, body: string) => {
      objects.set(key, body);
    });
    const get = vi.fn().mockImplementation(async (key: string) => {
      const body = objects.get(key);
      return body ? { json: async () => JSON.parse(body) } : null;
    });
    const sql = memorySql();
    // Budget reaches indexing but stops before sender resolution.
    await advanceSourceImportTick({
      env: { BUCKET: { put, get } } as unknown as Env,
      sql,
      budget: new SubrequestBudget(7),
      runId: run.id,
    });

    const names = sql
      .exec<{ message_name: string }>(
        "SELECT DISTINCT message_name FROM attachments ORDER BY message_name",
      )
      .toArray()
      .map((row) => row.message_name);
    expect(names).toEqual(["unnamed-0-0", "unnamed-0-1"]);
  });

  it("indexes the complete regenerated week before sender and attachment phases", async () => {
    sqlite
      .prepare(
        `INSERT INTO source_documents
          (id, source_id, path, title, r2_key, content_hash, captured_at, cursor)
         VALUES ('existing', ?, '2026-W27.md', 'Week', 'raw/week', 'hash', unixepoch(), ?)`,
      )
      .run(SOURCE_ID, "2026-07-03T00:00:00Z");
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };
    sqlite.prepare("UPDATE source_import_runs SET phase = 'indexing' WHERE id = ?").run(run.id);

    const sql = memorySql();
    sql.exec("INSERT INTO pages (page_index, r2_key, message_count) VALUES (0, 'delta', 1)");
    const delta = {
      messages: [{ name: "messages/new", createTime: "2026-07-04T00:00:00Z" }],
    };
    const oldMessage = {
      name: "messages/old",
      createTime: "2026-06-29T00:00:00Z",
      sender: { name: "users/old", type: "HUMAN" as const },
      attachment: [{ driveDataRef: { driveFileId: "old-file" }, contentName: "old.pdf" }],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [oldMessage, delta.messages[0]] })),
    );

    const result = await advanceSourceImportTick({
      env: {
        BUCKET: {
          get: vi.fn().mockResolvedValue({ json: async () => delta }),
        },
      } as unknown as Env,
      sql,
      budget: new SubrequestBudget(6),
      runId: run.id,
    });

    expect(result.phase).toBe("senders");
    expect(
      sql.exec<{ resource_name: string }>("SELECT resource_name FROM senders").toArray(),
    ).toEqual([{ resource_name: "users/old" }]);
    expect(
      sql.exec<{ content_name: string }>("SELECT content_name FROM attachments").toArray(),
    ).toEqual([{ content_name: "old.pdf" }]);
    expect(
      sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM week_messages").one(),
    ).toEqual({ count: 2 });
  });

  it("completes an empty Chat import through the deployed generic phase ladder", async () => {
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };
    const objects = new Map<string, string | Uint8Array>();
    const bucket = {
      put: vi.fn().mockImplementation(async (key: string, body: string | Uint8Array) => {
        objects.set(key, body);
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        const body = objects.get(key);
        if (body == null) return null;
        if (typeof body === "string") return { json: async () => JSON.parse(body) };
        return {
          arrayBuffer: async () =>
            body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        };
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      return new Response(
        JSON.stringify(url.includes("admin.googleapis.com") ? { users: [] } : {}),
      );
    });

    const result = await advanceSourceImportTick({
      env: { BUCKET: bucket } as unknown as Env,
      sql: memorySql(),
      budget: new SubrequestBudget(),
      runId: run.id,
    });

    expect(result).toMatchObject({ finished: true, phase: "complete" });
    expect(sqlite.prepare("SELECT status FROM sources WHERE id = ?").get(SOURCE_ID)).toEqual({
      status: "ready",
    });
    expect(sqlite.prepare("SELECT phase FROM source_import_runs WHERE id = ?").get(run.id)).toEqual(
      {
        phase: "complete",
      },
    );
  });

  it("does not call identity APIs and preserves sender resource IDs", async () => {
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };
    const objects = new Map<string, string | Uint8Array>();
    const bucket = {
      put: vi.fn().mockImplementation(async (key: string, body: string | Uint8Array) => {
        objects.set(key, body);
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        const body = objects.get(key);
        return typeof body === "string" ? { json: async () => JSON.parse(body) } : null;
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (!url.includes("/messages?")) {
        throw new Error(`Unexpected identity lookup: ${url}`);
      }
      return new Response(
        JSON.stringify({
          messages: [
            {
              name: "spaces/abc/messages/1",
              text: "Hello from a consumer space.",
              createTime: "2026-07-14T12:03:00Z",
              sender: { name: "users/111503568926175343887", type: "HUMAN" },
              thread: { name: "spaces/abc/threads/t1" },
              threadReply: false,
            },
          ],
        }),
      );
    });

    const result = await advanceSourceImportTick({
      env: { BUCKET: bucket } as unknown as Env,
      sql: memorySql(),
      budget: new SubrequestBudget(),
      runId: run.id,
    });

    expect(result).toMatchObject({ finished: true, phase: "complete" });
    const markdown = [...objects.entries()]
      .filter(([key]) => !key.includes("/chat-runs/"))
      .map(([, body]) => (typeof body === "string" ? body : new TextDecoder().decode(body)))
      .join("\n");
    expect(markdown).toContain("### [2026-07-14 21:03] Unknown user (users/111503568926175343887)");
    expect(
      sqlite
        .prepare(
          "SELECT resource_name, message_text FROM google_chat_sender_samples WHERE resource_name = ?",
        )
        .get("users/111503568926175343887"),
    ).toEqual({
      resource_name: "users/111503568926175343887",
      message_text: "Hello from a consumer space.",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps placeholders in Markdown even when a sender profile exists", async () => {
    sqlite
      .prepare(
        `INSERT INTO google_chat_sender_profiles (resource_name, display_name)
         VALUES ('users/named', 'Alice Example')`,
      )
      .run();
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };
    const objects = new Map<string, string | Uint8Array>();
    const bucket = {
      put: vi.fn().mockImplementation(async (key: string, body: string | Uint8Array) => {
        objects.set(key, body);
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        const body = objects.get(key);
        return typeof body === "string" ? { json: async () => JSON.parse(body) } : null;
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (!url.includes("/messages?")) {
        throw new Error(`Unexpected identity lookup: ${url}`);
      }
      return new Response(
        JSON.stringify({
          messages: [
            {
              name: "spaces/abc/messages/1",
              text: "Named but still a placeholder.",
              createTime: "2026-07-14T12:03:00Z",
              sender: { name: "users/named", type: "HUMAN" },
              thread: { name: "spaces/abc/threads/t1" },
              threadReply: false,
            },
          ],
        }),
      );
    });

    const result = await advanceSourceImportTick({
      env: { BUCKET: bucket } as unknown as Env,
      sql: memorySql(),
      budget: new SubrequestBudget(),
      runId: run.id,
    });

    expect(result).toMatchObject({ finished: true, phase: "complete" });
    const markdown = [...objects.entries()]
      .filter(([key]) => !key.includes("/chat-runs/"))
      .map(([, body]) => (typeof body === "string" ? body : new TextDecoder().decode(body)))
      .join("\n");
    expect(markdown).toContain("### [2026-07-14 21:03] Unknown user (users/named)");
    expect(markdown).not.toContain("Alice Example");
  });

  it("caps sender samples at 10 for a 300-message week without exceeding the budget", async () => {
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };
    const objects = new Map<string, string | Uint8Array>();
    const bucket = {
      put: vi.fn().mockImplementation(async (key: string, body: string | Uint8Array) => {
        objects.set(key, body);
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        const body = objects.get(key);
        return typeof body === "string" ? { json: async () => JSON.parse(body) } : null;
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const sender = "users/300msg";
    const messages = Array.from({ length: 300 }, (_, index) => ({
      name: `spaces/abc/messages/${index + 1}`,
      text: `Message ${index + 1}`,
      createTime: new Date(Date.UTC(2026, 6, 14, 12, 0, index)).toISOString(),
      sender: { name: sender, type: "HUMAN" as const },
      thread: { name: "spaces/abc/threads/t1" },
      threadReply: false,
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (!url.includes("/messages?")) {
        throw new Error(`Unexpected identity lookup: ${url}`);
      }
      return new Response(JSON.stringify({ messages }));
    });

    let sampleD1Statements = 0;
    setAfterExecute((sqlText) => {
      if (sqlText.includes("google_chat_sender_samples")) sampleD1Statements += 1;
    });

    const budget = new SubrequestBudget();
    const result = await advanceSourceImportTick({
      env: { BUCKET: bucket } as unknown as Env,
      sql: memorySql(),
      budget,
      runId: run.id,
    });

    expect(result).toMatchObject({ finished: true, phase: "complete" });
    expect(budget.spent).toBeLessThanOrEqual(budget.limit);
    // 10 upserts + 1 prune for a single sender — must not scale with message count.
    expect(sampleD1Statements).toBe(11);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM google_chat_sender_samples WHERE resource_name = ?")
        .get(sender),
    ).toEqual({ count: 10 });
    const retained = sqlite
      .prepare(
        `SELECT message_name FROM google_chat_sender_samples
         WHERE resource_name = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(sender) as Array<{ message_name: string }>;
    expect(retained.map((row) => row.message_name)).toEqual(
      Array.from({ length: 10 }, (_, index) => `spaces/abc/messages/${300 - index}`),
    );
  });

  it("resumes stepSenders flush across ticks without duplicating samples", async () => {
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };
    sqlite.prepare("UPDATE source_import_runs SET phase = 'senders' WHERE id = ?").run(run.id);

    const senderCount = SENDERS_FLUSH_BATCH_SIZE * 2 + 5;
    const sql = memorySql((database) => {
      for (let i = 0; i < senderCount; i += 1) {
        const resourceName = `users/flush-${String(i).padStart(3, "0")}`;
        database
          .prepare(
            `INSERT INTO sender_samples (resource_name, message_name, create_time, message_text)
             VALUES (?, ?, ?, ?)`,
          )
          .run(resourceName, `spaces/abc/messages/${i}`, "2026-07-14T12:00:00Z", `Sample ${i}`);
        database
          .prepare("INSERT INTO senders (resource_name, display_name) VALUES (?, NULL)")
          .run(resourceName);
      }
    });

    // CURRENT_RUN(2) + ACCESS(1) + profiles(1) + one flush batch(1) = 5.
    const first = await advanceSourceImportTick({
      env: {} as Env,
      sql,
      budget: new SubrequestBudget(5),
      runId: run.id,
    });
    expect(first).toMatchObject({ finished: false, phase: "senders" });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM google_chat_sender_samples").get(),
    ).toEqual({ count: SENDERS_FLUSH_BATCH_SIZE });

    const second = await advanceSourceImportTick({
      env: { BUCKET: { put: vi.fn(), get: vi.fn(), delete: vi.fn() } } as unknown as Env,
      sql,
      budget: new SubrequestBudget(),
      runId: run.id,
    });
    // No week documents → finalizing completes quickly; import finishes.
    expect(second.phase === "senders" || second.finished).toBe(true);

    const third =
      second.finished || second.phase !== "senders"
        ? second
        : await advanceSourceImportTick({
            env: { BUCKET: { put: vi.fn(), get: vi.fn(), delete: vi.fn() } } as unknown as Env,
            sql,
            budget: new SubrequestBudget(),
            runId: run.id,
          });

    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM google_chat_sender_samples").get(),
    ).toEqual({ count: senderCount });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM (
             SELECT resource_name, source_id, message_name
             FROM google_chat_sender_samples
             GROUP BY resource_name, source_id, message_name
             HAVING COUNT(*) > 1
           )`,
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(third.finished || third.phase !== "senders").toBe(true);
  });

  it("does not mutate source_documents when saving a sender name", async () => {
    const capturedAt = new Date("2026-07-14T12:00:00Z");
    sqlite
      .prepare(
        `INSERT INTO source_documents
           (id, source_id, path, title, r2_key, content_hash, media_type, status, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, 'text/markdown', 'ready', ?)`,
      )
      .run(
        "doc-1",
        SOURCE_ID,
        "2026/W29.md",
        "Week",
        "raw/chat-source-1/doc-1.md",
        "hash-unchanged",
        Math.floor(capturedAt.getTime() / 1000),
      );
    sqlite
      .prepare(
        `INSERT INTO google_chat_sender_samples
           (id, resource_name, source_id, message_name, message_text, created_at)
         VALUES ('sample-1', 'users/save-me', ?, 'spaces/abc/messages/1', 'Hi', ?)`,
      )
      .run(SOURCE_ID, Math.floor(capturedAt.getTime() / 1000));

    const put = vi.fn();
    await saveChatSenderName({ BUCKET: { put } } as unknown as Env, "users/save-me", "Saved Name");

    expect(put).not.toHaveBeenCalled();
    expect(
      sqlite
        .prepare("SELECT content_hash, captured_at FROM source_documents WHERE id = ?")
        .get("doc-1"),
    ).toEqual({
      content_hash: "hash-unchanged",
      captured_at: Math.floor(capturedAt.getTime() / 1000),
    });
    expect(
      sqlite
        .prepare("SELECT display_name FROM google_chat_sender_profiles WHERE resource_name = ?")
        .get("users/save-me"),
    ).toEqual({ display_name: "Saved Name" });
  });

  it("does not collect samples for senders that already have a profile", async () => {
    sqlite
      .prepare(
        `INSERT INTO google_chat_sender_profiles (resource_name, display_name)
         VALUES ('users/configured', 'Configured User')`,
      )
      .run();
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };
    const objects = new Map<string, string | Uint8Array>();
    const bucket = {
      put: vi.fn().mockImplementation(async (key: string, body: string | Uint8Array) => {
        objects.set(key, body);
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        const body = objects.get(key);
        return typeof body === "string" ? { json: async () => JSON.parse(body) } : null;
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (!url.includes("/messages?")) {
        throw new Error(`Unexpected identity lookup: ${url}`);
      }
      return new Response(
        JSON.stringify({
          messages: [
            {
              name: "spaces/abc/messages/1",
              text: "From configured sender.",
              createTime: "2026-07-14T12:03:00Z",
              sender: { name: "users/configured", type: "HUMAN" },
              thread: { name: "spaces/abc/threads/t1" },
              threadReply: false,
            },
            {
              name: "spaces/abc/messages/2",
              text: "From unknown sender.",
              createTime: "2026-07-14T12:04:00Z",
              sender: { name: "users/unknown", type: "HUMAN" },
              thread: { name: "spaces/abc/threads/t1" },
              threadReply: false,
            },
          ],
        }),
      );
    });

    const result = await advanceSourceImportTick({
      env: { BUCKET: bucket } as unknown as Env,
      sql: memorySql(),
      budget: new SubrequestBudget(),
      runId: run.id,
    });

    expect(result).toMatchObject({ finished: true, phase: "complete" });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM google_chat_sender_samples WHERE resource_name = ?")
        .get("users/configured"),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .prepare(
          "SELECT resource_name, message_text FROM google_chat_sender_samples WHERE resource_name = ?",
        )
        .get("users/unknown"),
    ).toEqual({
      resource_name: "users/unknown",
      message_text: "From unknown sender.",
    });
  });
});

describe("failSourceImportRun with the Chat driver", () => {
  it("retries retryable failures until the consecutive limit, then marks error", async () => {
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };

    for (let i = 1; i <= 4; i += 1) {
      const outcome = await failSourceImportRun(
        {} as Env,
        run.id,
        new Error("Google Chat messages.list failed (503)"),
      );
      expect(outcome).toEqual({ retryable: true, consecutiveFailures: i });
    }
    const final = await failSourceImportRun(
      {} as Env,
      run.id,
      new Error("Google Chat messages.list failed (503)"),
    );
    expect(final.retryable).toBe(false);
    expect(sqlite.prepare("SELECT phase FROM source_import_runs WHERE id = ?").get(run.id)).toEqual(
      { phase: "error" },
    );
    expect(sqlite.prepare("SELECT status FROM sources WHERE id = ?").get(SOURCE_ID)).toEqual({
      status: "error",
    });
  });

  it("stops immediately on non-retryable failures", async () => {
    await startSourceImport(
      { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
      await source(),
      "attempt-1",
    );
    const run = sqlite
      .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { id: string };

    const outcome = await failSourceImportRun(
      {} as Env,
      run.id,
      new Error("Google Chat scopes are missing"),
    );
    expect(outcome.retryable).toBe(false);
    expect(sqlite.prepare("SELECT phase FROM source_import_runs WHERE id = ?").get(run.id)).toEqual(
      { phase: "error" },
    );
  });
});
