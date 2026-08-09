import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSourcesTestDb } from "./test-db";

const { db, sqlite, setAfterExecute } = createSourcesTestDb();

const fetchGoogleDocSource = vi.fn();
const startGoogleChatImport = vi.fn();

vi.mock("../../../app/lib/db.server", () => ({ getDb: () => db }));
vi.mock("./google-doc", () => ({
  fetchGoogleDocSource: (...args: unknown[]) => fetchGoogleDocSource(...args),
}));
vi.mock("../../../app/lib/google-drive-token.server", () => ({
  getGoogleDriveAccessToken: async () => "token-1",
}));
vi.mock("./google-chat-import", () => ({
  startGoogleChatImport: (...args: unknown[]) => startGoogleChatImport(...args),
}));

import { enqueueDueSourceRefreshes, fetchSource } from "./fetch-source";

const SOURCE_ID = "src-1";

function env(): Env {
  return { BUCKET: { put: vi.fn().mockResolvedValue(undefined) } } as unknown as Env;
}

function seedSource(store: DatabaseSync) {
  store.exec("DELETE FROM source_documents; DELETE FROM sources;");
  store
    .prepare(
      `INSERT INTO sources (id, kind, url, title, added_by, status)
       VALUES (?, 'google-doc', 'https://docs.google.com/document/d/abc/edit', 'Doc', 'user-1', 'pending')`,
    )
    .run(SOURCE_ID);
}

function statusOf(store: DatabaseSync, id: string): string {
  return (store.prepare("SELECT status FROM sources WHERE id = ?").get(id) as { status: string })
    .status;
}

function fetchAttemptOf(store: DatabaseSync, id: string): string | null {
  return (
    store.prepare("SELECT fetch_attempt_id FROM sources WHERE id = ?").get(id) as {
      fetch_attempt_id: string | null;
    }
  ).fetch_attempt_id;
}

function documentStatuses(store: DatabaseSync): Record<string, string> {
  const rows = store
    .prepare("SELECT path, status FROM source_documents ORDER BY path")
    .all() as Array<{ path: string; status: string }>;
  return Object.fromEntries(rows.map((row) => [row.path, row.status]));
}

function fetchResult(paths: readonly string[], markdownById: (path: string) => string) {
  return {
    title: "Doc",
    accessToken: "token-1",
    documents: paths.map((path) => ({
      path,
      title: path,
      markdown: markdownById(path),
      images: [],
    })),
  };
}

beforeEach(() => {
  fetchGoogleDocSource.mockReset();
  startGoogleChatImport.mockReset().mockImplementation(async (...args: unknown[]) => {
    const attemptId = args[2] as string;
    sqlite
      .prepare("UPDATE sources SET status = 'fetching', fetch_attempt_id = ? WHERE id = ?")
      .run(attemptId, SOURCE_ID);
    return true;
  });
  setAfterExecute(undefined);
  seedSource(sqlite);
});

describe("fetchSource lifecycle", () => {
  it("skips a duplicate Google Chat start only when its persisted run owns the lease", async () => {
    sqlite
      .prepare(
        `UPDATE sources
         SET kind = 'google-chat-space', external_id = 'spaces/abc',
             status = 'fetching', fetch_attempt_id = 'attempt-1'
         WHERE id = ?`,
      )
      .run(SOURCE_ID);
    sqlite
      .prepare(
        `INSERT INTO google_chat_import_runs (id, source_id, fetch_attempt_id)
         VALUES ('run-1', ?, 'attempt-1')`,
      )
      .run(SOURCE_ID);

    const outcome = await fetchSource(env(), SOURCE_ID);

    expect(outcome).toEqual({ status: "skipped", retryable: false });
    expect(startGoogleChatImport).not.toHaveBeenCalled();
    expect(fetchAttemptOf(sqlite, SOURCE_ID)).toBe("attempt-1");
  });

  it("recovers a Google Chat fetching lease that has no persisted run", async () => {
    sqlite
      .prepare(
        `UPDATE sources
         SET kind = 'google-chat-space', external_id = 'spaces/abc',
             status = 'fetching', fetch_attempt_id = 'orphaned-attempt'
         WHERE id = ?`,
      )
      .run(SOURCE_ID);

    const outcome = await fetchSource(env(), SOURCE_ID);

    expect(outcome).toEqual({ status: "skipped", retryable: false });
    expect(startGoogleChatImport).toHaveBeenCalledOnce();
    expect(startGoogleChatImport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: SOURCE_ID }),
      expect.not.stringMatching(/^orphaned-attempt$/),
    );
    expect(fetchAttemptOf(sqlite, SOURCE_ID)).not.toBe("orphaned-attempt");
  });

  it("archives paths the source no longer returns", async () => {
    fetchGoogleDocSource.mockResolvedValue(
      fetchResult(["議事録", "廃止タブ"], (path) => `# ${path}`),
    );
    await fetchSource(env(), SOURCE_ID);
    expect(documentStatuses(sqlite)).toEqual({ 議事録: "ready", 廃止タブ: "ready" });

    // The tab was deleted in Google Docs; its captured material must stop reading as current.
    fetchGoogleDocSource.mockResolvedValue(fetchResult(["議事録"], (path) => `# ${path}`));
    await fetchSource(env(), SOURCE_ID);
    expect(documentStatuses(sqlite)).toEqual({ 議事録: "ready", 廃止タブ: "archived" });
  });

  it("restores an archived path when it comes back unchanged", async () => {
    fetchGoogleDocSource.mockResolvedValue(fetchResult(["A", "B"], (path) => `# ${path}`));
    await fetchSource(env(), SOURCE_ID);

    fetchGoogleDocSource.mockResolvedValue(fetchResult(["A"], (path) => `# ${path}`));
    await fetchSource(env(), SOURCE_ID);
    expect(documentStatuses(sqlite).B).toBe("archived");

    // Identical content skips the R2 write, so the revival has to happen on that path too.
    fetchGoogleDocSource.mockResolvedValue(fetchResult(["A", "B"], (path) => `# ${path}`));
    await fetchSource(env(), SOURCE_ID);
    expect(documentStatuses(sqlite).B).toBe("ready");
  });

  it("does not reopen a source archived while the fetch was in flight", async () => {
    fetchGoogleDocSource.mockImplementation(async () => {
      sqlite.prepare("UPDATE sources SET status = 'archived' WHERE id = ?").run(SOURCE_ID);
      return fetchResult(["議事録"], () => "# 議事録");
    });

    await fetchSource(env(), SOURCE_ID);

    expect(statusOf(sqlite, SOURCE_ID)).toBe("archived");
  });

  it("does not reopen a source archived while a failing fetch was in flight", async () => {
    fetchGoogleDocSource.mockImplementation(async () => {
      sqlite.prepare("UPDATE sources SET status = 'archived' WHERE id = ?").run(SOURCE_ID);
      throw new Error("Google Docs document retrieval failed (500): boom");
    });

    const outcome = await fetchSource(env(), SOURCE_ID);

    expect(outcome).toMatchObject({ status: "skipped", retryable: false });
    expect(statusOf(sqlite, SOURCE_ID)).toBe("archived");
  });

  it("marks the source ready on a normal completion", async () => {
    fetchGoogleDocSource.mockResolvedValue(fetchResult(["議事録"], () => "# 議事録"));

    const outcome = await fetchSource(env(), SOURCE_ID);

    expect(outcome).toMatchObject({ status: "ready" });
    expect(statusOf(sqlite, SOURCE_ID)).toBe("ready");
    expect(fetchAttemptOf(sqlite, SOURCE_ID)).toBeNull();
  });

  it("lets only the newest overlapping attempt persist and reconcile documents", async () => {
    let releaseFirstFetch: ((result: ReturnType<typeof fetchResult>) => void) | undefined;
    fetchGoogleDocSource
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof fetchResult>>((resolve) => {
            releaseFirstFetch = resolve;
          }),
      )
      .mockResolvedValueOnce(fetchResult(["new"], () => "# newer"));

    const first = fetchSource(env(), SOURCE_ID);
    await vi.waitFor(() => expect(fetchGoogleDocSource).toHaveBeenCalledTimes(1));

    const second = await fetchSource(env(), SOURCE_ID);
    expect(second).toMatchObject({ status: "ready" });
    expect(documentStatuses(sqlite)).toEqual({ new: "ready" });

    releaseFirstFetch?.(fetchResult(["old"], () => "# older"));
    const firstOutcome = await first;

    expect(firstOutcome).toMatchObject({ status: "skipped", retryable: false });
    expect(documentStatuses(sqlite)).toEqual({ new: "ready" });
    expect(fetchAttemptOf(sqlite, SOURCE_ID)).toBeNull();
  });
});

describe("scheduled source refresh", () => {
  it("does not reopen a source archived after cron candidate selection", async () => {
    sqlite
      .prepare(
        `UPDATE sources
         SET status = 'ready', refresh_policy = 'daily', last_fetched_at = 0
         WHERE id = ?`,
      )
      .run(SOURCE_ID);
    const send = vi.fn().mockResolvedValue(undefined);
    let archived = false;
    setAfterExecute((sql, _params, method) => {
      if (!archived && method === "all" && sql.includes('from "sources"')) {
        archived = true;
        sqlite.prepare("UPDATE sources SET status = 'archived' WHERE id = ?").run(SOURCE_ID);
      }
    });

    const enqueued = await enqueueDueSourceRefreshes({
      SOURCE_FETCH_QUEUE: { send },
    } as unknown as Env);

    expect(archived).toBe(true);
    expect(enqueued).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(statusOf(sqlite, SOURCE_ID)).toBe("archived");
  });
});
