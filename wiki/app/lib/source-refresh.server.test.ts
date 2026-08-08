import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSourcesTestDb } from "../../workers/features/sources/test-db";

const { db, sqlite } = createSourcesTestDb();

vi.mock("~/lib/db.server", () => ({ getDb: () => db }));

import { enqueueSourceRefresh } from "./sources.server";

const SOURCE_ID = "src-refresh";

function seedSource(store: DatabaseSync, status: "ready" | "archived" = "ready") {
  store.exec("DELETE FROM source_assets; DELETE FROM source_documents; DELETE FROM sources;");
  store
    .prepare(
      `INSERT INTO sources (id, kind, url, title, added_by, status)
       VALUES (?, 'google-doc', 'https://docs.google.com/document/d/abc/edit', 'Doc', 'user-1', ?)`,
    )
    .run(SOURCE_ID, status);
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
