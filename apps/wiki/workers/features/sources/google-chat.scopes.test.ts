import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { beforeEach } from "vitest";
import * as schema from "../../../app/db/schema";
import { GOOGLE_CHAT_REAUTH_MESSAGE } from "./google-chat";
import { createSourcesTestDb } from "./test-db";

const getTokenRow = vi.fn();
const { db, sqlite } = createSourcesTestDb();

vi.mock("../../../app/features/google/drive-token.server", () => ({
  getGoogleDriveTokenRow: (...args: unknown[]) => getTokenRow(...args),
}));
vi.mock("../../../app/lib/db.server", () => ({ getDb: () => db }));
vi.mock("../../../app/features/google/drive.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../app/features/google/drive.server")>()),
  REQUIRED_GOOGLE_CHAT_SCOPES: ["https://www.googleapis.com/auth/chat.messages.readonly"],
  hasRequiredGoogleChatScopes: (scopes: string | null) =>
    Boolean(scopes?.includes("chat.messages.readonly")),
}));

import { type SourceImportClaimRequest, claimSourceImport, startSourceImport } from "./import/run";

const SOURCE_ID = "scope-source-1";

describe("Google Chat import scope gate", () => {
  beforeEach(() => {
    getTokenRow.mockReset();
    sqlite.exec("DELETE FROM source_import_runs; DELETE FROM sources;");
    sqlite
      .prepare(
        `INSERT INTO sources (id, kind, url, external_id, title, added_by, status)
         VALUES (?, 'google-chat-space', '', 'spaces/AAA', 'Chat', 'user-1', 'pending')`,
      )
      .run(SOURCE_ID);
  });

  it("defers the scope check to the resumable tick after starting the DO", async () => {
    getTokenRow.mockResolvedValue({
      accessToken: "token",
      grantedScopes: "https://www.googleapis.com/auth/drive.readonly",
    });
    const start = vi.fn((request: SourceImportClaimRequest) =>
      claimSourceImport({} as Env, request).then(Boolean),
    );
    const source = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, SOURCE_ID))
      .get();
    if (!source) throw new Error("missing source");

    await expect(
      startSourceImport(
        { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
        source,
        "attempt-1",
      ),
    ).resolves.toBe(true);

    expect(start).toHaveBeenCalledOnce();
  });
});
