import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "~/lib/crypto.server";
import type { GoogleOAuthTokenRow } from "~/lib/db.server";
import {
  GoogleNotConnectedError,
  codeChallenge,
  getValidGoogleAccessToken,
  randomVerifier,
} from "~/lib/google-oauth.server";

const ENCRYPTION_KEY = "test-encryption-key";

function makeEnv(row: GoogleOAuthTokenRow | null) {
  const first = vi.fn().mockResolvedValue(row);
  const run = vi.fn().mockResolvedValue(undefined);
  const bind = vi.fn(() => ({ first, run }));
  const prepare = vi.fn(() => ({ bind }));
  const env = {
    DB: { prepare } as unknown as D1Database,
    TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
    GOOGLE_OAUTH_CLIENT_ID: "client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  } as unknown as Env;
  return { env, run };
}

function makeRow(overrides: Partial<GoogleOAuthTokenRow> = {}): Promise<GoogleOAuthTokenRow> {
  return (async () => ({
    user_id: "user-1",
    google_email: "admin@example.com",
    access_token_enc: await encryptSecret(ENCRYPTION_KEY, "current-token"),
    refresh_token_enc: await encryptSecret(ENCRYPTION_KEY, "refresh-token"),
    access_token_expires_at: Math.floor(Date.now() / 1000) + 3600,
    template_granted_at: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }))();
}

describe("randomVerifier / codeChallenge", () => {
  it("produces a URL-safe verifier and a deterministic SHA-256 challenge", async () => {
    const verifier = randomVerifier();
    expect(verifier).not.toMatch(/[+/=]/);
    const challenge = await codeChallenge(verifier);
    expect(challenge).not.toMatch(/[+/=]/);
    expect(await codeChallenge(verifier)).toBe(challenge);
  });
});

describe("getValidGoogleAccessToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws GoogleNotConnectedError when nothing is connected", async () => {
    const { env } = makeEnv(null);
    await expect(getValidGoogleAccessToken(env, "user-1")).rejects.toBeInstanceOf(
      GoogleNotConnectedError,
    );
  });

  it("returns the stored access token without refreshing when still valid", async () => {
    const row = await makeRow({ access_token_expires_at: Math.floor(Date.now() / 1000) + 3600 });
    const { env } = makeEnv(row);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getValidGoogleAccessToken(env, "user-1")).resolves.toBe("current-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes the token when within the 60s expiry buffer", async () => {
    const row = await makeRow({ access_token_expires_at: Math.floor(Date.now() / 1000) + 10 });
    const { env, run } = makeEnv(row);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new-token", expires_in: 3600 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getValidGoogleAccessToken(env, "user-1")).resolves.toBe("new-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("throws GoogleNotConnectedError when the refresh request fails", async () => {
    const row = await makeRow({ access_token_expires_at: Math.floor(Date.now() / 1000) - 10 });
    const { env } = makeEnv(row);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    await expect(getValidGoogleAccessToken(env, "user-1")).rejects.toBeInstanceOf(
      GoogleNotConnectedError,
    );
  });
});
