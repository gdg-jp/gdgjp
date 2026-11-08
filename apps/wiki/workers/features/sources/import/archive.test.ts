import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSourcesTestDb } from "../test-db";
import { archiveMissingDocuments } from "./archive";

const testDb = createSourcesTestDb();
const { sqlite, setAfterExecute } = testDb;
// The proxy-driver test database stands in for the D1 one archive.ts is typed against.
const db = testDb.db as unknown as Parameters<typeof archiveMissingDocuments>[0];

/** D1 rejects a statement that binds more than this many parameters. */
const D1_MAX_BOUND_PARAMETERS = 100;

function seed(paths: string[]) {
  sqlite.exec("DELETE FROM source_documents; DELETE FROM sources;");
  sqlite
    .prepare(
      `INSERT INTO sources (id, kind, url, title, added_by, status, fetch_attempt_id)
       VALUES ('s1', 'google-drive-folder', 'https://drive.google.com/drive/folders/f', 'F',
               'user-1', 'fetching', 'attempt-1')`,
    )
    .run();
  const insert = sqlite.prepare(
    `INSERT INTO source_documents (id, source_id, path, title, r2_key, content_hash, captured_at)
     VALUES (?, 's1', ?, ?, ?, 'h', 0)`,
  );
  for (const [index, path] of paths.entries()) {
    insert.run(`d${index}`, path, path, `spaces/c-2/raw/s1/${path}`);
  }
}

function statuses() {
  return Object.fromEntries(
    (
      sqlite.prepare("SELECT path, status FROM source_documents").all() as Array<{
        path: string;
        status: string;
      }>
    ).map((row) => [row.path, row.status]),
  );
}

describe("archiveMissingDocuments", () => {
  beforeEach(() => setAfterExecute(undefined));

  it("archives only the paths this fetch did not return, however many it returned", async () => {
    const kept = Array.from({ length: 250 }, (_, i) => `File ${i}/index.md`);
    seed([...kept, "Gone/index.md", "Gone/index.pdf"]);
    let widest = 0;
    setAfterExecute((_sql, params) => {
      widest = Math.max(widest, params.length);
    });
    const bucket = { delete: vi.fn(async () => undefined) };

    await expect(
      archiveMissingDocuments(db, "s1", "attempt-1", kept, bucket as unknown as R2Bucket),
    ).resolves.toBe(true);

    expect(widest).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
    const result = statuses();
    expect(result["Gone/index.md"]).toBe("archived");
    expect(result["Gone/index.pdf"]).toBe("archived");
    expect(kept.every((path) => result[path] === "ready")).toBe(true);
    expect(bucket.delete).toHaveBeenCalledWith([
      "spaces/c-2/raw/s1/Gone/index.md",
      "spaces/c-2/raw/s1/Gone/index.pdf",
    ]);
  });

  it("archives every document when the fetch returned none", async () => {
    seed(["a.md", "b.md"]);
    await archiveMissingDocuments(db, "s1", "attempt-1", []);
    expect(statuses()).toEqual({ "a.md": "archived", "b.md": "archived" });
  });

  it("keeps paths with quotes and non-ASCII names", async () => {
    const odd = ['Q"uote/index.md', "企画書 - GDG Tokyo/MTG LOG.md", "a'b/Sheet1.pdf"];
    seed([...odd, "drop.md"]);
    await archiveMissingDocuments(db, "s1", "attempt-1", odd);
    expect(statuses()).toEqual({
      'Q"uote/index.md': "ready",
      "企画書 - GDG Tokyo/MTG LOG.md": "ready",
      "a'b/Sheet1.pdf": "ready",
      "drop.md": "archived",
    });
  });
});
