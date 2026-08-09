import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../app/db/schema";
import { createSourcesTestDb } from "./test-db";

const { db, sqlite } = createSourcesTestDb();
const send = vi.fn();

vi.mock("../../../app/lib/db.server", () => ({ getDb: () => db }));
vi.mock("../../../app/lib/google-drive-token.server", () => ({
  getGoogleDriveTokenRow: vi.fn().mockResolvedValue({
    accessToken: "token-1",
    grantedScopes: "google-chat",
  }),
}));
vi.mock("../../../app/lib/google-drive.server", () => ({
  hasRequiredGoogleChatScopes: () => true,
}));

import { startGoogleChatImport } from "./google-chat-import";

const SOURCE_ID = "chat-source-1";

async function source() {
  const row = await db.select().from(schema.sources).where(eq(schema.sources.id, SOURCE_ID)).get();
  if (!row) throw new Error("source fixture missing");
  return row;
}

beforeEach(() => {
  send.mockReset().mockResolvedValue(undefined);
  sqlite.exec("DELETE FROM google_chat_import_runs; DELETE FROM sources;");
  sqlite
    .prepare(
      `INSERT INTO sources (id, kind, url, external_id, title, added_by, status)
       VALUES (?, 'google-chat-space', '', 'spaces/abc', 'Chat', 'user-1', 'pending')`,
    )
    .run(SOURCE_ID);
});

describe("startGoogleChatImport", () => {
  it("atomically claims the source and persists its run before enqueueing work", async () => {
    const started = await startGoogleChatImport(
      { SOURCE_FETCH_QUEUE: { send } } as unknown as Env,
      await source(),
      "attempt-1",
    );

    const storedSource = sqlite
      .prepare("SELECT status, fetch_attempt_id FROM sources WHERE id = ?")
      .get(SOURCE_ID) as { status: string; fetch_attempt_id: string };
    const run = sqlite
      .prepare("SELECT fetch_attempt_id FROM google_chat_import_runs WHERE source_id = ?")
      .get(SOURCE_ID) as { fetch_attempt_id: string };

    expect(started).toBe(true);
    expect(storedSource).toEqual({ status: "fetching", fetch_attempt_id: "attempt-1" });
    expect(run.fetch_attempt_id).toBe("attempt-1");
    expect(send).toHaveBeenCalledWith({
      type: "google_chat_import",
      runId: expect.any(String),
      work: "list",
    });
  });

  it("does not reopen or enqueue an archived source", async () => {
    sqlite.prepare("UPDATE sources SET status = 'archived' WHERE id = ?").run(SOURCE_ID);

    const started = await startGoogleChatImport(
      { SOURCE_FETCH_QUEUE: { send } } as unknown as Env,
      await source(),
      "attempt-1",
    );

    expect(started).toBe(false);
    expect(sqlite.prepare("SELECT status FROM sources WHERE id = ?").get(SOURCE_ID)).toEqual({
      status: "archived",
    });
    expect(
      sqlite.prepare("SELECT id FROM google_chat_import_runs WHERE source_id = ?").get(SOURCE_ID),
    ).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
