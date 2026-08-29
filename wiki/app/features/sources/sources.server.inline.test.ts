import type { DatabaseSync } from "node:sqlite";
import type { AuthUser } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSourcesTestDb } from "../../../workers/features/sources/test-db";

const { db, sqlite, setAfterExecute } = createSourcesTestDb();
vi.mock("~/lib/db.server", () => ({ getDb: () => db }));

import { MAX_INLINE_SOURCE_BYTES, createInlineSource } from "./sources.server";

const MEMBER = { id: "user-1", isAdmin: false } as AuthUser;
const OTHER = { id: "user-2", isAdmin: false } as AuthUser;
const BUCKET_CONTENT = new Map<string, Uint8Array>();
let failPut = false;

const bucket = {
  put: vi.fn(async (key: string, body: ArrayBuffer | ArrayBufferView | string) => {
    if (failPut) throw new Error("R2 unavailable");
    const bytes =
      typeof body === "string"
        ? new TextEncoder().encode(body)
        : body instanceof ArrayBuffer
          ? new Uint8Array(body)
          : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    BUCKET_CONTENT.set(key, new Uint8Array(bytes));
  }),
} as unknown as Pick<R2Bucket, "put">;

function env(): Env {
  return { BUCKET: bucket } as unknown as Env;
}

function reset(store: DatabaseSync) {
  store.exec("DELETE FROM source_documents; DELETE FROM sources;");
  store.exec("INSERT OR IGNORE INTO user (id) VALUES ('user-2');");
  BUCKET_CONTENT.clear();
  failPut = false;
  setAfterExecute(undefined);
  vi.mocked(bucket.put).mockClear();
}

function input(user: AuthUser = MEMBER, externalId = "session-1", content = "# Log\n\nHello") {
  return {
    title: "Conversation",
    content,
    visibility: "chapter-member",
    chapter: "chapter-1",
    externalId,
    user,
    chapters: [{ chapterId: "chapter-1", role: "member" }],
  } as const;
}

beforeEach(() => reset(sqlite));

describe("createInlineSource", () => {
  it("persists R2 and source_documents before returning a ready source", async () => {
    const result = await createInlineSource(env(), input());
    expect(result).toMatchObject({ ok: true, source: { kind: "conversation", status: "ready" } });
    if (!result.ok) return;
    expect(result.source.id).toBeTruthy();
    expect(sqlite.prepare("SELECT kind, status, url FROM sources").get()).toMatchObject({
      kind: "conversation",
      status: "ready",
      url: "gdg-memory://session-1",
    });
    expect(sqlite.prepare("SELECT path, media_type, status FROM source_documents").get()).toEqual({
      path: "conversation.md",
      media_type: "text/markdown",
      status: "ready",
    });
    expect(bucket.put).toHaveBeenCalledTimes(1);
  });

  it("is idempotent for the same owner and external id", async () => {
    const first = await createInlineSource(env(), input());
    const second = await createInlineSource(env(), input());
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (!first.ok || !second.ok) return;
    expect(second.source.id).toBe(first.source.id);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM sources").get()).toEqual({ count: 1 });
    expect(bucket.put).toHaveBeenCalledTimes(1);
  });

  it("recovers a deterministic unique collision without returning 500", async () => {
    let injected = false;
    setAfterExecute((sql, _params, method) => {
      if (!injected && method === "run" && sql.includes('insert into "sources"')) {
        injected = true;
        throw new Error("UNIQUE constraint failed: idx_sources_owner_kind_external_id");
      }
    });

    const result = await createInlineSource(env(), input());
    expect(result).toMatchObject({ ok: true, source: { status: "ready" } });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM sources").get()).toEqual({ count: 1 });
    expect(bucket.put).toHaveBeenCalledTimes(1);
  });

  it("does not label an unrelated insert failure as a conflict", async () => {
    setAfterExecute((sql, _params, method) => {
      if (method === "run" && sql.includes('insert into "sources"')) {
        throw new Error("D1 unavailable");
      }
    });

    await expect(createInlineSource(env(), input())).resolves.toMatchObject({
      ok: false,
      error: "storage_error",
      status: 503,
    });
  });

  it("leaves a failed write fetching and repairs it on retry", async () => {
    failPut = true;
    await expect(createInlineSource(env(), input())).resolves.toMatchObject({
      ok: false,
      error: "persist_failed",
      status: 503,
    });
    expect(sqlite.prepare("SELECT status FROM sources").get()).toEqual({ status: "fetching" });

    failPut = false;
    const repaired = await createInlineSource(env(), input());
    expect(repaired).toMatchObject({ ok: true, source: { status: "ready" } });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM sources").get()).toEqual({ count: 1 });
  });

  it("scopes idempotency by owner", async () => {
    const first = await createInlineSource(env(), input());
    const second = await createInlineSource(env(), input(OTHER));
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (!first.ok || !second.ok) return;
    expect(second.source.id).not.toBe(first.source.id);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM sources").get()).toEqual({ count: 2 });
  });

  it("does not let another owner repair or overwrite a fetching source", async () => {
    failPut = true;
    const failed = await createInlineSource(env(), input(MEMBER, "shared", "A content"));
    expect(failed).toMatchObject({ ok: false, error: "persist_failed" });
    const sourceA = sqlite
      .prepare("SELECT id, status FROM sources WHERE added_by = 'user-1'")
      .get() as { id: string; status: string };
    failPut = false;

    const ownerB = await createInlineSource(env(), input(OTHER, "shared", "B content"));
    expect(ownerB).toMatchObject({ ok: true, source: { status: "ready" } });
    expect(sqlite.prepare("SELECT status FROM sources WHERE id = ?").get(sourceA.id)).toEqual({
      status: "fetching",
    });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM sources").get()).toEqual({ count: 2 });

    const repairedA = await createInlineSource(env(), input(MEMBER, "shared", "A content"));
    expect(repairedA).toMatchObject({ ok: true, source: { id: sourceA.id, status: "ready" } });
    const aDocument = sqlite
      .prepare("SELECT r2_key FROM source_documents WHERE source_id = ?")
      .get(sourceA.id) as { r2_key: string };
    expect(new TextDecoder().decode(BUCKET_CONTENT.get(aDocument.r2_key))).toBe("A content");
  });

  it("rejects invalid visibility, foreign chapters, empty, and oversized content", async () => {
    await expect(
      createInlineSource(env(), { ...input(), visibility: undefined }),
    ).resolves.toMatchObject({ error: "invalid_visibility", status: 400 });
    await expect(
      createInlineSource(env(), { ...input(), chapter: "other" }),
    ).resolves.toMatchObject({ error: "forbidden_chapter", status: 403 });
    await expect(createInlineSource(env(), { ...input(), content: "" })).resolves.toMatchObject({
      error: "content_required",
      status: 400,
    });
    await expect(
      createInlineSource(env(), {
        ...input(),
        content: "x".repeat(MAX_INLINE_SOURCE_BYTES + 1),
      }),
    ).resolves.toMatchObject({ error: "content_too_large", status: 413 });
    expect(bucket.put).not.toHaveBeenCalled();
  });
});
