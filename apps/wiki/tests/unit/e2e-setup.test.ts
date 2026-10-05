import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_E2E_PERSISTENCE_PATH,
  E2E_ISSUER_ENV,
  E2E_PERSISTENCE_ENV,
  E2E_SESSION_SECRET_ENV,
  TEST_PAGE,
  USERS,
  buildSessionCookieValue,
  readE2EAuthConfig,
  resolveE2EPersistencePath,
  signCookie,
} from "../../tests/e2e/setup";

describe("Wiki E2E setup contract", () => {
  it("accepts only the dedicated in-workspace persistence path", () => {
    expect(resolveE2EPersistencePath(undefined, "/tmp/wiki")).toBe("/tmp/wiki/.wrangler/e2e-state");
    expect(() => resolveE2EPersistencePath(".wrangler/state", "/tmp/wiki")).toThrow(
      E2E_PERSISTENCE_ENV,
    );
    expect(() => resolveE2EPersistencePath("../outside", "/tmp/wiki")).toThrow(E2E_PERSISTENCE_ENV);
    expect(DEFAULT_E2E_PERSISTENCE_PATH).toBe(".wrangler/e2e-state");
  });

  it("requires a non-production localhost issuer and a dedicated test secret", () => {
    expect(() => readE2EAuthConfig({})).toThrow(E2E_SESSION_SECRET_ENV);
    expect(() =>
      readE2EAuthConfig({
        [E2E_SESSION_SECRET_ENV]: "test-secret",
      }),
    ).toThrow(E2E_ISSUER_ENV);
    expect(() =>
      readE2EAuthConfig({
        [E2E_SESSION_SECRET_ENV]: "test-secret",
        [E2E_ISSUER_ENV]: "https://accounts.gdgs.jp",
      }),
    ).toThrow(/localhost/);
    expect(
      readE2EAuthConfig({
        [E2E_SESSION_SECRET_ENV]: "test-secret",
        [E2E_ISSUER_ENV]: "http://localhost:5173/",
      }),
    ).toEqual({ secret: "test-secret", issuer: "http://localhost:5173" });
  });

  it("signs the exact RP cookie payload shape without exposing the secret", () => {
    const cookie = buildSessionCookieValue(USERS.author, "test-secret", "http://localhost:5173");
    const [body, signature] = cookie.split(".");
    expect(body).toBeTruthy();
    expect(signature).toBeTruthy();
    expect(signature).toBe(
      createHmac("sha256", "test-secret").update(body).digest("base64url").replace(/=+$/, ""),
    );
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      version: number;
      userId: string;
      issuer: string;
      subject: string;
      isAdmin: boolean;
      expiresAt: number;
    };
    expect(payload).toMatchObject({
      version: 3,
      userId: USERS.author.id,
      issuer: "http://localhost:5173",
      subject: USERS.author.id,
      isAdmin: false,
    });
    expect(payload.expiresAt).toBeGreaterThan(Date.now());
    expect(signCookie({ ok: true }, "test-secret")).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(cookie).not.toContain("test-secret");
  });

  it("keeps fixture identities stable for storage-state retries", () => {
    expect(Object.keys(USERS)).toEqual(["admin", "author", "member"]);
    expect(TEST_PAGE).toEqual({
      id: "e2e-test-page-id",
      slug: "e2e-test-page",
      authorId: USERS.author.id,
    });
  });
});
