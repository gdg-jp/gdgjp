import type { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../app/db/schema";
import { createSourcesTestDb } from "./test-db";

const { db, sqlite, setAfterExecute } = createSourcesTestDb();

vi.mock("../../../app/lib/db.server", () => ({ getDb: () => db }));

import { enqueueDueSourceRefreshes, fetchSource } from "./fetch-source";
import { type SourceImportClaimRequest, claimSourceImport, startSourceImport } from "./import/run";

const SOURCE_ID = "src-1";

function seedSource(store: DatabaseSync, kind = "google-doc") {
  store.exec("DELETE FROM source_import_runs; DELETE FROM source_documents; DELETE FROM sources;");
  store
    .prepare(
      `INSERT INTO sources (id, kind, url, title, added_by, status)
       VALUES (?, ?, 'https://docs.google.com/document/d/abc/edit', 'Doc', 'user-1', 'pending')`,
    )
    .run(SOURCE_ID, kind);
}

function sourceDo(
  start = vi.fn((request: SourceImportClaimRequest) =>
    claimSourceImport({} as Env, request).then(Boolean),
  ),
): Env {
  return { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env;
}

beforeEach(() => {
  setAfterExecute(undefined);
  seedSource(sqlite);
});

describe("fetchSource Durable Object dispatch", () => {
  it("creates one generic run and hands continuation to the source DO", async () => {
    const start = vi.fn((request: SourceImportClaimRequest) =>
      claimSourceImport({} as Env, request).then(Boolean),
    );
    const outcome = await fetchSource(sourceDo(start), SOURCE_ID);

    expect(outcome).toEqual({ status: "skipped", retryable: false });
    expect(start).toHaveBeenCalledOnce();
    expect(
      sqlite
        .prepare("SELECT kind, phase FROM source_import_runs WHERE source_id = ?")
        .get(SOURCE_ID),
    ).toEqual({ kind: "google-drive", phase: "start" });
  });

  it("uses the Chat driver identity and first phase", async () => {
    sqlite.prepare("UPDATE sources SET kind = 'google-chat-space' WHERE id = ?").run(SOURCE_ID);
    await fetchSource(sourceDo(), SOURCE_ID);

    expect(
      sqlite
        .prepare("SELECT kind, phase FROM source_import_runs WHERE source_id = ?")
        .get(SOURCE_ID),
    ).toEqual({ kind: "google-chat-space", phase: "listing" });
  });

  it("does not replace a run that already owns the fetching lease", async () => {
    sqlite
      .prepare(
        `INSERT INTO source_import_runs (id, source_id, kind, fetch_attempt_id)
         VALUES ('run-1', ?, 'google-drive', 'attempt-1')`,
      )
      .run(SOURCE_ID);
    sqlite
      .prepare(
        "UPDATE sources SET status = 'fetching', fetch_attempt_id = 'attempt-1' WHERE id = ?",
      )
      .run(SOURCE_ID);
    const start = vi.fn();

    expect(await fetchSource(sourceDo(start), SOURCE_ID)).toEqual({
      status: "skipped",
      retryable: false,
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("recovers a fetching lease with no durable run", async () => {
    sqlite
      .prepare("UPDATE sources SET status = 'fetching', fetch_attempt_id = 'orphaned' WHERE id = ?")
      .run(SOURCE_ID);
    const start = vi.fn((request: SourceImportClaimRequest) =>
      claimSourceImport({} as Env, request).then(Boolean),
    );

    await fetchSource(sourceDo(start), SOURCE_ID);

    expect(start).toHaveBeenCalledOnce();
    expect(
      sqlite.prepare("SELECT fetch_attempt_id FROM sources WHERE id = ?").get(SOURCE_ID),
    ).not.toEqual({ fetch_attempt_id: "orphaned" });
  });

  it("releases the D1 lease when the Durable Object cannot start", async () => {
    const start = vi.fn().mockRejectedValue(new Error("DO unavailable"));

    expect(await fetchSource(sourceDo(start), SOURCE_ID)).toEqual({
      status: "error",
      retryable: true,
    });
    expect(
      sqlite.prepare("SELECT id FROM source_import_runs WHERE source_id = ?").get(SOURCE_ID),
    ).toBeUndefined();
    expect(
      sqlite.prepare("SELECT status, fetch_attempt_id FROM sources WHERE id = ?").get(SOURCE_ID),
    ).toEqual({ status: "pending", fetch_attempt_id: null });
  });

  it("allows only one delivery to claim the same source snapshot", async () => {
    const snapshot = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, SOURCE_ID))
      .get();
    if (!snapshot) throw new Error("missing source");
    const firstStart = vi.fn((request: SourceImportClaimRequest) =>
      claimSourceImport({} as Env, request).then(Boolean),
    );
    const secondStart = vi.fn((request: SourceImportClaimRequest) =>
      claimSourceImport({} as Env, request).then(Boolean),
    );

    await expect(startSourceImport(sourceDo(firstStart), snapshot, "attempt-1")).resolves.toBe(
      true,
    );
    await expect(startSourceImport(sourceDo(secondStart), snapshot, "attempt-2")).resolves.toBe(
      false,
    );

    expect(firstStart).toHaveBeenCalledOnce();
    expect(secondStart).toHaveBeenCalledOnce();
    expect(
      sqlite
        .prepare("SELECT fetch_attempt_id FROM source_import_runs WHERE source_id = ?")
        .get(SOURCE_ID),
    ).toEqual({ fetch_attempt_id: "attempt-1" });
  });

  it("does not let a rejected stale start delete a newer run", async () => {
    const snapshot = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, SOURCE_ID))
      .get();
    if (!snapshot) throw new Error("missing source");
    sqlite
      .prepare("UPDATE sources SET fetch_attempt_id = 'request-new' WHERE id = ?")
      .run(SOURCE_ID);
    await expect(
      claimSourceImport({} as Env, {
        sourceId: SOURCE_ID,
        expectedStatus: "pending",
        expectedFetchAttemptId: "request-new",
        fetchAttemptId: "attempt-new",
      }),
    ).resolves.toEqual(expect.objectContaining({ sourceId: SOURCE_ID }));
    const start = vi.fn((request: SourceImportClaimRequest) =>
      claimSourceImport({} as Env, request).then(Boolean),
    );

    await expect(startSourceImport(sourceDo(start), snapshot, "attempt-stale")).resolves.toBe(
      false,
    );
    expect(
      sqlite
        .prepare("SELECT id, fetch_attempt_id FROM source_import_runs WHERE source_id = ?")
        .get(SOURCE_ID),
    ).toEqual({ id: expect.any(String), fetch_attempt_id: "attempt-new" });
    expect(
      sqlite.prepare("SELECT status, fetch_attempt_id FROM sources WHERE id = ?").get(SOURCE_ID),
    ).toEqual({ status: "fetching", fetch_attempt_id: "attempt-new" });
  });
});

describe("scheduled source refresh", () => {
  it("repairs a stale manual pending source even though it is not a scheduled policy", async () => {
    sqlite
      .prepare("UPDATE sources SET refresh_policy = 'manual', updated_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 60 * 60 - 1, SOURCE_ID);
    const send = vi.fn().mockResolvedValue(undefined);

    expect(
      await enqueueDueSourceRefreshes({ SOURCE_FETCH_QUEUE: { send } } as unknown as Env),
    ).toBe(1);
    expect(send).toHaveBeenCalledWith({ type: "source_fetch", sourceId: SOURCE_ID });
  });

  it("does not enqueue a source archived after candidate selection", async () => {
    sqlite
      .prepare(
        "UPDATE sources SET status = 'ready', refresh_policy = 'daily', last_fetched_at = 0 WHERE id = ?",
      )
      .run(SOURCE_ID);
    setAfterExecute((sql, _params, method) => {
      if (method === "all" && sql.includes('from "sources"')) {
        sqlite.prepare("UPDATE sources SET status = 'archived' WHERE id = ?").run(SOURCE_ID);
      }
    });
    const send = vi.fn().mockResolvedValue(undefined);

    expect(
      await enqueueDueSourceRefreshes({ SOURCE_FETCH_QUEUE: { send } } as unknown as Env),
    ).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
