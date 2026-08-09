import { describe, expect, it } from "vitest";

import { decryptToken, encryptToken, parseTokenEncryptionKeys } from "./token-crypto";

function keyB64(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return Buffer.from(bytes).toString("base64");
}

describe("parseTokenEncryptionKeys", () => {
  it("selects the highest version as current", () => {
    const keyring = parseTokenEncryptionKeys(JSON.stringify({ "1": keyB64(1), "2": keyB64(2) }));
    expect(keyring.currentVersion).toBe(2);
    expect(keyring.keys.size).toBe(2);
  });

  it("rejects non-32-byte keys", () => {
    expect(() =>
      parseTokenEncryptionKeys(JSON.stringify({ "1": Buffer.from("short").toString("base64") })),
    ).toThrow(/32 bytes/);
  });

  it("rejects empty maps", () => {
    expect(() => parseTokenEncryptionKeys("{}")).toThrow(/no keys/);
  });
});

describe("encryptToken / decryptToken", () => {
  it.each(["access-token-value", "refresh-token-value"])(
    "round-trips an OAuth token: %s",
    async (token) => {
      const keyring = parseTokenEncryptionKeys(JSON.stringify({ "1": keyB64(7) }));
      const encrypted = await encryptToken(token, keyring);
      expect(encrypted.keyVersion).toBe(1);
      expect(encrypted.ciphertext).not.toContain(token);
      const plain = await decryptToken(encrypted, keyring);
      expect(plain).toBe(token);
    },
  );

  it("decrypts a v1 record after v2 becomes current", async () => {
    const v1Only = parseTokenEncryptionKeys(JSON.stringify({ "1": keyB64(1) }));
    const written = await encryptToken("legacy-refresh", v1Only);
    expect(written.keyVersion).toBe(1);

    const rotated = parseTokenEncryptionKeys(JSON.stringify({ "1": keyB64(1), "2": keyB64(2) }));
    expect(rotated.currentVersion).toBe(2);
    expect(await decryptToken(written, rotated)).toBe("legacy-refresh");

    const reencrypted = await encryptToken("legacy-refresh", rotated);
    expect(reencrypted.keyVersion).toBe(2);
    expect(await decryptToken(reencrypted, rotated)).toBe("legacy-refresh");
  });

  it("uses a unique IV per encryption", async () => {
    const keyring = parseTokenEncryptionKeys(JSON.stringify({ "1": keyB64(3) }));
    const a = await encryptToken("same", keyring);
    const b = await encryptToken("same", keyring);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
