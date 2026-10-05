import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "~/lib/crypto.server";

describe("encryptSecret", () => {
  it("round-trips account numbers", async () => {
    const secret = "test-encryption-key";
    const enc = await encryptSecret(secret, "114533");
    expect(enc).toContain(".");
    expect(await decryptSecret(secret, enc)).toBe("114533");
  });
});
