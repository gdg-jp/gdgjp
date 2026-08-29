import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSourcesTestDb } from "../../workers/features/sources/test-db";

const { db, sqlite } = createSourcesTestDb();

vi.mock("~/lib/db.server", () => ({ getDb: () => db }));

import { deleteArchivedSource, enqueueSourceRefresh, unarchiveSource } from "./sources.server";

const SOURCE_ID = "src-refresh";

function seedSource(
  store: DatabaseSync,
  status: "ready" | "archived" = "ready",
  kind = "google-doc",
) {
  store.exec("DELETE FROM source_assets; DELETE FROM source_documents; DELETE FROM sources;");
  store
    .prepare(
      `INSERT INTO sources (id, kind, url, title, added_by, status)
       VALUES (?, ?, 'https://docs.google.com/document/d/abc/edit', 'Doc', 'user-1', ?)`,
    )
    .run(SOURCE_ID, kind, status);
}

function sourceState(store: DatabaseSync) {
  return store
    .prepare("SELECT status, fetch_attempt_id, error_message FROM sources WHERE id = ?")
    .get(SOURCE_ID) as {
    status: string;
    fetch_attempt_id: string | null;
    error_message: string | null;
  };
}

function env(send: ReturnType<typeof vi.fn>): Env {
  return { SOURCE_FETCH_QUEUE: { send } } as unknown as Env;
}

function sourceEnv(bucket: Pick<R2Bucket, "list" | "delete">): Env {
  return { BUCKET: bucket } as unknown as Env;
}

beforeEach(() => {
  seedSource(sqlite);
});

describe("enqueueSourceRefresh", () => {
  it("owns the pending refresh until its queue message is accepted", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await expect(enqueueSourceRefresh(env(send), SOURCE_ID)).resolves.toEqual({ ok: true });

    expect(send).toHaveBeenCalledWith({ type: "source_fetch", sourceId: SOURCE_ID });
    expect(sourceState(sqlite)).toMatchObject({
      status: "pending",
      error_message: null,
    });
    expect(sourceState(sqlite).fetch_attempt_id).toEqual(expect.any(String));
  });

  it("does not reopen a source archived after the caller's access check", async () => {
    seedSource(sqlite, "archived");
    const send = vi.fn();

    await expect(enqueueSourceRefresh(env(send), SOURCE_ID)).resolves.toEqual({
      ok: false,
      error: "archived",
      status: 409,
    });

    expect(send).not.toHaveBeenCalled();
    expect(sourceState(sqlite)).toEqual({
      status: "archived",
      fetch_attempt_id: null,
      error_message: null,
    });
  });

  it("rejects non-fetchable conversation sources without changing status", async () => {
    seedSource(sqlite, "ready", "conversation");
    const send = vi.fn();

    await expect(enqueueSourceRefresh(env(send), SOURCE_ID)).resolves.toEqual({
      ok: false,
      error: "unsupported_source_kind",
      status: 409,
    });
    expect(send).not.toHaveBeenCalled();
    expect(sourceState(sqlite)).toMatchObject({ status: "ready", fetch_attempt_id: null });
  });

  it("does not let an older enqueue failure overwrite a newer completed fetch", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const send = vi.fn().mockImplementation(async () => {
      sqlite
        .prepare(
          `UPDATE sources
           SET status = 'ready', fetch_attempt_id = NULL, error_message = NULL
           WHERE id = ?`,
        )
        .run(SOURCE_ID);
      throw new Error("queue unavailable");
    });

    await expect(enqueueSourceRefresh(env(send), SOURCE_ID)).resolves.toEqual({
      ok: false,
      error: "enqueue_failed",
      status: 503,
    });

    expect(sourceState(sqlite)).toEqual({
      status: "ready",
      fetch_attempt_id: null,
      error_message: null,
    });
    consoleError.mockRestore();
  });
});

describe("archived source lifecycle", () => {
  it("restores an archived source to ready without queuing a fetch", async () => {
    seedSource(sqlite, "archived");

    await expect(unarchiveSource({} as Env, SOURCE_ID)).resolves.toEqual({ ok: true });

    expect(sourceState(sqlite)).toMatchObject({ status: "ready", fetch_attempt_id: null });
  });

  it("deletes every paginated raw-object page before removing the archived source", async () => {
    seedSource(sqlite, "archived");
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [{ key: `raw/${SOURCE_ID}/one.md` }],
        delimitedPrefixes: [],
        truncated: true,
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        objects: [{ key: `raw/${SOURCE_ID}/two.md` }],
        delimitedPrefixes: [],
        truncated: false,
      });
    const remove = vi.fn().mockResolvedValue(undefined);

    await expect(
      deleteArchivedSource(sourceEnv({ list, delete: remove }), SOURCE_ID),
    ).resolves.toEqual({
      ok: true,
    });

    expect(list).toHaveBeenNthCalledWith(1, { prefix: `raw/${SOURCE_ID}/`, cursor: undefined });
    expect(list).toHaveBeenNthCalledWith(2, { prefix: `raw/${SOURCE_ID}/`, cursor: "next-page" });
    expect(remove).toHaveBeenCalledWith([`raw/${SOURCE_ID}/one.md`]);
    expect(remove).toHaveBeenCalledWith([`raw/${SOURCE_ID}/two.md`]);
    expect(sqlite.prepare("SELECT id FROM sources WHERE id = ?").get(SOURCE_ID)).toBeUndefined();
  });

  it("keeps the archived source when raw-storage deletion fails", async () => {
    seedSource(sqlite, "archived");
    const list = vi.fn().mockRejectedValue(new Error("R2 unavailable"));
    const remove = vi.fn();

    await expect(
      deleteArchivedSource(sourceEnv({ list, delete: remove }), SOURCE_ID),
    ).resolves.toEqual({
      ok: false,
      error: "delete_failed",
      status: 503,
    });

    expect(sourceState(sqlite)).toMatchObject({ status: "archived" });
    expect(remove).not.toHaveBeenCalled();
  });
});
