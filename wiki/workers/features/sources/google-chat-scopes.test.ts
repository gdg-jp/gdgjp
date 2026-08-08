import { beforeEach, describe, expect, it, vi } from "vitest";

const getTokenRow = vi.fn();
const selectAll = vi.fn();

vi.mock("../../../app/lib/google-drive-token.server", () => ({
  getGoogleDriveTokenRow: (...args: unknown[]) => getTokenRow(...args),
}));

vi.mock("../../../app/lib/db.server", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          all: selectAll,
        }),
      }),
    }),
  }),
}));

import { GOOGLE_CHAT_REAUTH_MESSAGE, fetchGoogleChatSource } from "./google-chat";

describe("fetchGoogleChatSource scope gate", () => {
  beforeEach(() => {
    getTokenRow.mockReset();
    selectAll.mockReset();
  });

  it("stops with error and does not call Chat when scopes are missing", async () => {
    getTokenRow.mockResolvedValue({
      accessToken: "token",
      grantedScopes: "https://www.googleapis.com/auth/drive.readonly",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      fetchGoogleChatSource({} as Env, {
        sourceId: "src-1",
        spaceName: "spaces/AAA",
        addedBy: "user-1",
      }),
    ).rejects.toThrow(GOOGLE_CHAT_REAUTH_MESSAGE);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(selectAll).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
