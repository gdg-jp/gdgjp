import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MARKDOWN_MEDIA_TYPE, PDF_MEDIA_TYPE, markdownBody } from "./media-type";
import { createSourcesTestDb } from "./test-db";

const { db, sqlite } = createSourcesTestDb();
const putMock = vi.fn();
let generatedId = 0;

vi.mock("../../../app/lib/db.server", () => ({ getDb: () => db }));
vi.mock("nanoid", () => ({
  nanoid: () => {
    generatedId += 1;
    return generatedId === 1 ? "doc-fixed-id" : `asset-fixed-id-${generatedId}`;
  },
}));

import { persistSourceDocument, rawObjectKey, sha256Hex } from "./persist";

const SOURCE_ID = "src-1";
const ATTEMPT_ID = "attempt-1";

function env(): Env {
  return { BUCKET: { put: putMock } } as unknown as Env;
}

function seedSource(store: DatabaseSync) {
  store.exec("DELETE FROM source_assets; DELETE FROM source_documents; DELETE FROM sources;");
  store
    .prepare(
      `INSERT INTO sources (id, kind, url, title, added_by, status, fetch_attempt_id)
       VALUES (?, 'google-doc', 'https://docs.google.com/document/d/abc/edit', 'Doc', 'user-1',
               'fetching', ?)`,
    )
    .run(SOURCE_ID, ATTEMPT_ID);
}

beforeEach(() => {
  generatedId = 0;
  putMock.mockReset();
  putMock.mockResolvedValue(undefined);
  seedSource(sqlite);
});

describe("persistSourceDocument", () => {
  it("skips the R2 write when content_hash is unchanged", async () => {
    const input = {
      sourceId: SOURCE_ID,
      fetchAttemptId: ATTEMPT_ID,
      path: "index",
      title: "Hello",
      body: markdownBody("# Hello"),
      mediaType: MARKDOWN_MEDIA_TYPE,
    };
    await persistSourceDocument(env(), input);
    putMock.mockClear();

    const result = await persistSourceDocument(env(), input);

    expect(result).toMatchObject({ skipped: false, written: false });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("moves an unchanged v1-layout document to its v2 key (layout migration)", async () => {
    const input = {
      sourceId: SOURCE_ID,
      fetchAttemptId: ATTEMPT_ID,
      path: "index",
      title: "Hello",
      body: markdownBody("# Hello"),
      mediaType: MARKDOWN_MEDIA_TYPE,
    };
    await persistSourceDocument(env(), input);
    sqlite.exec(`UPDATE source_documents SET r2_key = 'raw/src-1/doc/legacy.md'`);
    putMock.mockClear();

    const result = await persistSourceDocument(env(), input);

    expect(result).toMatchObject({ written: true, contentChanged: false });
    expect(putMock).toHaveBeenCalledWith(
      rawObjectKey("gdg-jp", SOURCE_ID, "index"),
      expect.any(Uint8Array),
      expect.any(Object),
    );
    expect(sqlite.prepare("SELECT r2_key FROM source_documents").get()).toEqual({
      r2_key: rawObjectKey("gdg-jp", SOURCE_ID, "index"),
    });
  });

  it("tags raw objects with the source's audience", async () => {
    sqlite.exec(`UPDATE sources SET visibility = 'organizer'`);
    await persistSourceDocument(env(), {
      sourceId: SOURCE_ID,
      fetchAttemptId: ATTEMPT_ID,
      path: "index",
      title: "Hello",
      body: markdownBody("# Secret"),
      mediaType: MARKDOWN_MEDIA_TYPE,
    });
    expect(putMock.mock.calls[0]?.[2]).toMatchObject({
      customMetadata: { audience: "organizer", layer: "raw", source_id: SOURCE_ID },
    });
  });

  it("writes content and its replacement assets together", async () => {
    const result = await persistSourceDocument(env(), {
      sourceId: SOURCE_ID,
      fetchAttemptId: ATTEMPT_ID,
      path: "index",
      title: "Hello",
      body: markdownBody("# Hello"),
      mediaType: MARKDOWN_MEDIA_TYPE,
      assets: [
        {
          path: "raw/src-1/assets/hello.png",
          r2Key: "raw/src-1/assets/hello.png",
          mimeType: "image/png",
          byteSize: 12,
          contentHash: "asset-hash",
        },
      ],
    });

    const hash = await sha256Hex(new TextEncoder().encode("# Hello"));
    expect(result).toMatchObject({ skipped: false, written: true, contentHash: hash });
    // v2 layout: one object per document under its space, tagged for AI Search.
    expect(putMock).toHaveBeenCalledWith(
      rawObjectKey("gdg-jp", SOURCE_ID, "index"),
      expect.any(Uint8Array),
      expect.objectContaining({
        customMetadata: expect.objectContaining({
          layer: "raw",
          source_id: SOURCE_ID,
          audience: expect.any(String),
        }),
      }),
    );
    expect(sqlite.prepare("SELECT path FROM source_assets ORDER BY path").all()).toEqual([
      { path: "raw/src-1/assets/hello.png" },
    ]);
  });

  it("merges incremental assets without dropping historical attachments", async () => {
    await persistSourceDocument(env(), {
      sourceId: SOURCE_ID,
      fetchAttemptId: ATTEMPT_ID,
      path: "2026-08",
      title: "August",
      body: markdownBody("# First"),
      mediaType: MARKDOWN_MEDIA_TYPE,
      assets: [
        {
          path: "raw/src-1/assets/first.png",
          r2Key: "raw/src-1/assets/first.png",
          mimeType: "image/png",
          byteSize: 10,
          contentHash: "first",
        },
      ],
    });

    await persistSourceDocument(env(), {
      sourceId: SOURCE_ID,
      fetchAttemptId: ATTEMPT_ID,
      path: "2026-08",
      title: "August",
      body: markdownBody("# First\n\n# Second"),
      mediaType: MARKDOWN_MEDIA_TYPE,
      assetPolicy: "merge",
      assets: [
        {
          path: "raw/src-1/assets/second.png",
          r2Key: "raw/src-1/assets/second.png",
          mimeType: "image/png",
          byteSize: 20,
          contentHash: "second",
        },
      ],
    });

    expect(sqlite.prepare("SELECT path FROM source_assets ORDER BY path").all()).toEqual([
      { path: "raw/src-1/assets/first.png" },
      { path: "raw/src-1/assets/second.png" },
    ]);
  });

  it("replaces stale assets during a full-document refresh", async () => {
    await persistSourceDocument(env(), {
      sourceId: SOURCE_ID,
      fetchAttemptId: ATTEMPT_ID,
      path: "index",
      title: "Document",
      body: markdownBody("# First"),
      mediaType: MARKDOWN_MEDIA_TYPE,
      assets: [
        {
          path: "raw/src-1/assets/stale.png",
          r2Key: "raw/src-1/assets/stale.png",
          mimeType: "image/png",
          byteSize: 10,
          contentHash: "stale",
        },
      ],
    });

    await persistSourceDocument(env(), {
      sourceId: SOURCE_ID,
      fetchAttemptId: ATTEMPT_ID,
      path: "index",
      title: "Document",
      body: markdownBody("# Updated"),
      mediaType: MARKDOWN_MEDIA_TYPE,
      assetPolicy: "replace",
      assets: [
        {
          path: "raw/src-1/assets/current.png",
          r2Key: "raw/src-1/assets/current.png",
          mimeType: "image/png",
          byteSize: 20,
          contentHash: "current",
        },
      ],
    });

    expect(sqlite.prepare("SELECT path FROM source_assets ORDER BY path").all()).toEqual([
      { path: "raw/src-1/assets/current.png" },
    ]);
  });

  it("writes no document or asset rows after its lease is superseded", async () => {
    sqlite.prepare("UPDATE sources SET fetch_attempt_id = 'attempt-2' WHERE id = ?").run(SOURCE_ID);

    const result = await persistSourceDocument(env(), {
      sourceId: SOURCE_ID,
      fetchAttemptId: ATTEMPT_ID,
      path: "index",
      title: "Hello",
      body: markdownBody("# Hello"),
      mediaType: MARKDOWN_MEDIA_TYPE,
      assets: [],
    });

    expect(result).toEqual({ skipped: true });
    expect(putMock).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM source_documents").get()).toEqual({
      count: 0,
    });
  });

  it("does not publish an R2 pointer after losing the lease during the put", async () => {
    putMock.mockImplementationOnce(async () => {
      sqlite
        .prepare("UPDATE sources SET fetch_attempt_id = 'attempt-2' WHERE id = ?")
        .run(SOURCE_ID);
    });

    const result = await persistSourceDocument(env(), {
      sourceId: SOURCE_ID,
      fetchAttemptId: ATTEMPT_ID,
      path: "index",
      title: "Hello",
      body: markdownBody("# Hello"),
      mediaType: MARKDOWN_MEDIA_TYPE,
      assets: [
        {
          path: "raw/src-1/assets/hello.png",
          r2Key: "raw/src-1/assets/hello.png",
          mimeType: "image/png",
          byteSize: 12,
          contentHash: "asset-hash",
        },
      ],
    });

    expect(result).toEqual({ skipped: true });
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM source_documents").get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM source_assets").get()).toEqual({
      count: 0,
    });
  });

  it("uses a PDF R2 key and binary content type for a PDF document", async () => {
    const body = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const result = await persistSourceDocument(env(), {
      sourceId: SOURCE_ID,
      fetchAttemptId: ATTEMPT_ID,
      path: "slides.pdf",
      title: "Slides PDF",
      body,
      mediaType: PDF_MEDIA_TYPE,
    });

    const hash = await sha256Hex(body);
    expect(result.r2Key).toBe(rawObjectKey("gdg-jp", SOURCE_ID, "slides.pdf"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(putMock).toHaveBeenCalledWith(
      expect.stringMatching(/\.pdf$/),
      body,
      expect.objectContaining({ httpMetadata: { contentType: PDF_MEDIA_TYPE } }),
    );
    expect(sqlite.prepare("SELECT media_type FROM source_documents").get()).toEqual({
      media_type: PDF_MEDIA_TYPE,
    });
  });
});
