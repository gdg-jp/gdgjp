import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSourcesTestDb } from "./test-db";

const { db, sqlite } = createSourcesTestDb();

const fetchGoogleDocSource = vi.fn();

vi.mock("../../../app/lib/db.server", () => ({ getDb: () => db }));
vi.mock("./google-doc", () => ({
  fetchGoogleDocSource: (...args: unknown[]) => fetchGoogleDocSource(...args),
}));
vi.mock("../../../app/lib/google-drive-token.server", () => ({
  getGoogleDriveAccessToken: async () => "token-1",
}));

import { fetchSource } from "./fetch-source";

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
  seedSource(sqlite);
});

describe("fetchSource lifecycle", () => {
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

    expect(outcome).toMatchObject({ status: "error", retryable: true });
    expect(statusOf(sqlite, SOURCE_ID)).toBe("archived");
  });

  it("marks the source ready on a normal completion", async () => {
    fetchGoogleDocSource.mockResolvedValue(fetchResult(["議事録"], () => "# 議事録"));

    const outcome = await fetchSource(env(), SOURCE_ID);

    expect(outcome).toMatchObject({ status: "ready" });
    expect(statusOf(sqlite, SOURCE_ID)).toBe("ready");
  });
});
