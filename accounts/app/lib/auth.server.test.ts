import { describe, expect, it } from "vitest";
import { OAUTH_STATE_STORAGE } from "./auth.server";

describe("accounts auth", () => {
  it("keeps Google OAuth transaction state out of D1", () => {
    expect(OAUTH_STATE_STORAGE).toBe("cookie");
  });
});
