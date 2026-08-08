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

  it("logs Google error metadata when messages.list rejects the request", async () => {
    getTokenRow.mockResolvedValue({
      accessToken: "token",
      grantedScopes: [
        "https://www.googleapis.com/auth/chat.spaces.readonly",
        "https://www.googleapis.com/auth/chat.messages.readonly",
        "https://www.googleapis.com/auth/directory.readonly",
      ].join(" "),
    });
    selectAll.mockResolvedValue([]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message: "Invalid filter expression.",
            details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest" }],
          },
        }),
        { status: 400, statusText: "Bad Request" },
      ),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      fetchGoogleChatSource({} as Env, {
        sourceId: "src-1",
        spaceName: "spaces/AAA",
        addedBy: "user-1",
      }),
    ).rejects.toThrow("Google Chat messages.list failed (400)");

    expect(errorSpy).toHaveBeenCalledWith(
      JSON.stringify({
        component: "sources",
        integration: "google-chat",
        event: "messages_list_failed",
        httpStatus: 400,
        httpStatusText: "Bad Request",
        spaceName: "spaces/AAA",
        pageSize: 1000,
        orderBy: "ASC",
        filter: undefined,
        hasPageToken: false,
        googleError: {
          code: 400,
          status: "INVALID_ARGUMENT",
          message: "Invalid filter expression.",
          details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest" }],
        },
      }),
    );
    errorSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});
