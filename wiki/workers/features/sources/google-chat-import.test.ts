import { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../app/db/schema";
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

function memorySql(): SqlStorage {
  const sqliteDb = new DatabaseSync(":memory:");
  const api = {
    exec<T extends Record<string, SqlStorageValue>>(query: string, ...binds: unknown[]) {
      const trimmed = query.trim().toUpperCase();
      if (trimmed.startsWith("SELECT") || trimmed.startsWith("WITH")) {
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
    const objects = new Map<string, string>();
    const bucket = {
      put: vi.fn().mockImplementation(async (key: string, body: string) => {
        objects.set(key, body);
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        const body = objects.get(key);
        return body ? { json: async () => JSON.parse(body) } : null;
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
