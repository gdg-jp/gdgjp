import { describe, expect, it } from "vitest";
import { OAUTH_STATE_STORAGE, SessionLookupTimeoutError, withTimeout } from "./auth.server";

describe("accounts auth", () => {
  it("keeps Google OAuth transaction state out of D1", () => {
    expect(OAUTH_STATE_STORAGE).toBe("cookie");
  });

  it("does not let a stalled session lookup wait forever", async () => {
    await expect(withTimeout(new Promise<never>(() => undefined), 1)).rejects.toBeInstanceOf(
      SessionLookupTimeoutError,
    );
  });

  it("preserves a session lookup result that arrives before its deadline", async () => {
    await expect(withTimeout(Promise.resolve("session"), 1_000)).resolves.toBe("session");
  });
});
