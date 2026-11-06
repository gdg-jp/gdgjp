import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, parseTokenEncryptionKeys } from "./token-crypto";

const key = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));

describe("token crypto (v1-compatible keyring)", () => {
  it("encrypts with the newest key and decrypts old versions", async () => {
    const v1 = parseTokenEncryptionKeys(JSON.stringify({ 1: key(1) }));
    const old = await encryptToken("secret", v1);
    const v2 = parseTokenEncryptionKeys(JSON.stringify({ 1: key(1), 2: key(2) }));
    expect(v2.currentVersion).toBe(2);
    expect(await decryptToken(old, v2)).toBe("secret");
    expect((await encryptToken("x", v2)).keyVersion).toBe(2);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => parseTokenEncryptionKeys(JSON.stringify({ 1: btoa("short") }))).toThrow();
  });
});
