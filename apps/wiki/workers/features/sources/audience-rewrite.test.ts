import { beforeEach, describe, expect, it, vi } from "vitest";
import { rawObjectKey } from "../../../app/features/sources/raw-object";
import { createSourcesTestDb } from "./test-db";

const { db, sqlite } = createSourcesTestDb();

vi.mock("../../../app/lib/db.server", () => ({ getDb: () => db }));

import { type SourceAudienceRewriteMessage, rewriteSourceAudience } from "./audience-rewrite";

const SOURCE_ID = "src-1";
const OTHER_SOURCE_ID = "src-2";

type StoredObject = {
  body: string;
  httpMetadata: { contentType: string };
  customMetadata: Record<string, string>;
};

function bucket(objects: Map<string, StoredObject>) {
  return {
    get: vi.fn(async (key: string) => {
      const object = objects.get(key);
      if (!object) return null;
      return {
        httpMetadata: object.httpMetadata,
        arrayBuffer: async () => new TextEncoder().encode(object.body).buffer,
      };
    }),
    put: vi.fn(
      async (
        key: string,
        body: ArrayBuffer,
        options: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> },
      ) => {
        objects.set(key, {
          body: new TextDecoder().decode(body),
          httpMetadata: options.httpMetadata,
          customMetadata: options.customMetadata,
        });
      },
    ),
  };
}

function seedSource(id: string, visibility: string, chapterId: string | null) {
  sqlite
    .prepare(
      `INSERT INTO sources (id, kind, url, title, added_by, status, visibility, chapter_id)
       VALUES (?, 'website', ?, 'Site', 'user-1', 'ready', ?, ?)`,
    )
    .run(id, `https://example.com/${id}`, visibility, chapterId);
}

function seedDocuments(
  sourceId: string,
  count: number,
  objects: Map<string, StoredObject>,
): string[] {
  const keys: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const path = `page-${String(index).padStart(3, "0")}.md`;
    const key = rawObjectKey("gdg-jp", sourceId, path);
    sqlite
      .prepare(
        `INSERT INTO source_documents (id, source_id, path, title, r2_key, content_hash, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
      )
      .run(
        `${sourceId}-doc-${String(index).padStart(3, "0")}`,
        sourceId,
        path,
        path,
        key,
        `h${index}`,
      );
    objects.set(key, {
      body: `body ${index}`,
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: { layer: "raw", audience: "member", source_id: sourceId },
    });
    keys.push(key);
  }
  return keys;
}

async function drain(env: Env, sent: SourceAudienceRewriteMessage[]) {
  let message: SourceAudienceRewriteMessage = {
    type: "source_audience_rewrite",
    sourceId: SOURCE_ID,
  };
  for (let round = 0; round < 10; round += 1) {
    const result = await rewriteSourceAudience(env, message);
    if (result.done) return round + 1;
    const next = sent.at(-1);
    if (!next) throw new Error("rewrite stopped without continuing through the queue");
    message = next;
  }
  throw new Error("rewrite did not finish");
}

beforeEach(() => {
  sqlite.exec("DELETE FROM source_documents; DELETE FROM sources;");
});

describe("rewriteSourceAudience", () => {
  it("re-tags every raw object of the source with its new audience across queue batches", async () => {
    const objects = new Map<string, StoredObject>();
    seedSource(SOURCE_ID, "chapter-organizer", "tokyo");
    seedSource(OTHER_SOURCE_ID, "member", null);
    const keys = seedDocuments(SOURCE_ID, 95, objects);
    const [otherKey] = seedDocuments(OTHER_SOURCE_ID, 1, objects);
    const sent: SourceAudienceRewriteMessage[] = [];
    const env = {
      BUCKET: bucket(objects),
      SOURCE_FETCH_QUEUE: { send: vi.fn(async (body) => void sent.push(body)) },
    } as unknown as Env;

    const rounds = await drain(env, sent);

    expect(rounds).toBeGreaterThan(1);
    for (const [index, key] of keys.entries()) {
      expect(objects.get(key), key).toEqual({
        body: `body ${index}`,
        httpMetadata: { contentType: "text/markdown; charset=utf-8" },
        customMetadata: expect.objectContaining({
          audience: "chapter-organizer:tokyo",
          source_id: SOURCE_ID,
          sha256: `h${index}`,
        }),
      });
    }
    expect(objects.get(otherKey as string)?.customMetadata.audience).toBe("member");
  });
});
