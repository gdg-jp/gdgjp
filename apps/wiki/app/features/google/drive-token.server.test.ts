import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/google/drive.server", () => ({
  refreshAccessToken: vi.fn(async () => ({
    accessToken: "fresh",
    expiresAt: new Date(Date.now() + 3600_000),
    grantedScopes: null,
  })),
}));

import { refreshAccessToken } from "~/features/google/drive.server";
import { TOKEN_REFRESH_MARGIN_MS, getGoogleDriveTokenRow } from "./drive-token.server";

/** Just enough of Drizzle's select / update chains for one token row. */
function fakeDb(expiresAt: Date) {
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          get: async () => ({
            accessToken: "stored",
            refreshToken: "refresh-1",
            expiresAt,
            grantedScopes: "drive",
          }),
        }),
      }),
    }),
    update,
  };
  return { db: db as never, update };
}

const env = { GOOGLE_DOCS_CLIENT_ID: "id", GOOGLE_DOCS_CLIENT_SECRET: "secret" } as Env;

describe("getGoogleDriveTokenRow", () => {
  afterEach(() => vi.clearAllMocks());

  it("keeps a token with plenty of time left", async () => {
    const { db, update } = fakeDb(new Date(Date.now() + TOKEN_REFRESH_MARGIN_MS + 60_000));
    await expect(getGoogleDriveTokenRow(env, db, "u1")).resolves.toEqual({
      accessToken: "stored",
      grantedScopes: "drive",
    });
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("refreshes a token that expires within the margin, not only after it expired", async () => {
    const { db, update } = fakeDb(new Date(Date.now() + 2_000));
    await expect(getGoogleDriveTokenRow(env, db, "u1")).resolves.toEqual({
      accessToken: "fresh",
      grantedScopes: "drive",
    });
    expect(refreshAccessToken).toHaveBeenCalledWith("refresh-1", "id", "secret");
    expect(update).toHaveBeenCalledOnce();
  });
});
