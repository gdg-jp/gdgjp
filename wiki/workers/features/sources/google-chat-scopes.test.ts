import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { beforeEach } from "vitest";
import * as schema from "../../../app/db/schema";
import {
  GOOGLE_CHAT_REAUTH_MESSAGE,
  resolvePeopleDisplayNames,
  resolveSpaceMemberDisplayNames,
} from "./google-chat";
import { createSourcesTestDb } from "./test-db";

const getTokenRow = vi.fn();
const { db, sqlite } = createSourcesTestDb();

vi.mock("../../../app/lib/google-drive-token.server", () => ({
  getGoogleDriveTokenRow: (...args: unknown[]) => getTokenRow(...args),
}));
vi.mock("../../../app/lib/db.server", () => ({ getDb: () => db }));
vi.mock("../../../app/lib/google-drive.server", () => ({
  hasRequiredGoogleChatScopes: (scopes: string | null) =>
    Boolean(scopes?.includes("chat.messages.readonly") && scopes.includes("directory.readonly")),
}));

import { startGoogleChatImport } from "./google-chat-import";

const SOURCE_ID = "scope-source-1";

describe("Google Chat import scope gate", () => {
  beforeEach(() => {
    getTokenRow.mockReset();
    sqlite.exec("DELETE FROM google_chat_import_runs; DELETE FROM sources;");
    sqlite
      .prepare(
        `INSERT INTO sources (id, kind, url, external_id, title, added_by, status)
         VALUES (?, 'google-chat-space', '', 'spaces/AAA', 'Chat', 'user-1', 'pending')`,
      )
      .run(SOURCE_ID);
  });

  it("stops with error and does not start the DO when scopes are missing", async () => {
    getTokenRow.mockResolvedValue({
      accessToken: "token",
      grantedScopes: "https://www.googleapis.com/auth/drive.readonly",
    });
    const start = vi.fn();
    const source = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, SOURCE_ID))
      .get();
    if (!source) throw new Error("missing source");

    await expect(
      startGoogleChatImport(
        { CHAT_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
        source,
        "attempt-1",
      ),
    ).rejects.toThrow(GOOGLE_CHAT_REAUTH_MESSAGE);

    expect(start).not.toHaveBeenCalled();
  });
});

describe("sender resolution batching", () => {
  it("resolves N unique senders with O(unique/200) People batchGet calls", async () => {
    const senders = Array.from({ length: 250 }, (_, i) => ({
      name: `users/${i}`,
      type: "HUMAN" as const,
    }));
    let calls = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      calls += 1;
      const url = String(input);
      if (url.includes("people:batchGet")) {
        const params = new URL(url).searchParams.getAll("resourceNames");
        return new Response(
          JSON.stringify({
            responses: params.map((resourceName) => ({
              requestedResourceName: resourceName,
              httpStatusCode: 200,
              person: {
                resourceName,
                names: [{ displayName: `Name ${resourceName}` }],
              },
            })),
          }),
        );
      }
      return new Response(null, { status: 404 });
    });

    const names = await resolvePeopleDisplayNames("token", senders);
    expect(calls).toBe(2);
    expect(names.size).toBe(250);
    fetchSpy.mockRestore();
  });

  it("prefers spaces.members.list display names when available", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          memberships: [
            {
              member: {
                name: "users/111",
                displayName: "Taro Yamada",
                type: "HUMAN",
              },
            },
          ],
        }),
      ),
    );

    const names = await resolveSpaceMemberDisplayNames("spaces/AAA", "token");
    expect(names.get("users/111")).toBe("Taro Yamada");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});
