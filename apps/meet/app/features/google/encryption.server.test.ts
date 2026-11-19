import { describe, expect, it } from "vitest";
import {
  CURRENT_ENCRYPTION_KEY_VERSION,
  GOOGLE_CONNECTION_AAD,
  type GoogleEncryptionEnv,
  base64UrlToBytes,
  bytesToBase64Url,
  decryptRefreshToken,
  encryptRefreshToken,
} from "~/features/google/encryption.server";

const TEST_ENV: GoogleEncryptionEnv = {
  GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32).fill(9)).toString("base64"),
};

describe("encryptRefreshToken / decryptRefreshToken", () => {
  it("AES-GCM で暗号化と復号を往復できる", async () => {
    const encrypted = await encryptRefreshToken(
      TEST_ENV,
      GOOGLE_CONNECTION_AAD,
      "1//0g-test-refresh-token",
    );
    expect(encrypted.keyVersion).toBe(CURRENT_ENCRYPTION_KEY_VERSION);

    const decrypted = await decryptRefreshToken(
      TEST_ENV,
      GOOGLE_CONNECTION_AAD,
      encrypted.keyVersion,
      encrypted.ciphertext,
      encrypted.nonce,
    );
    expect(decrypted).toBe("1//0g-test-refresh-token");
  });

  it("毎回異なるランダム nonce を生成する", async () => {
    const a = await encryptRefreshToken(TEST_ENV, GOOGLE_CONNECTION_AAD, "same-token");
    const b = await encryptRefreshToken(TEST_ENV, GOOGLE_CONNECTION_AAD, "same-token");
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("別の AAD では復号に失敗する", async () => {
    const encrypted = await encryptRefreshToken(TEST_ENV, "google-connection:1", "secret-token");
    await expect(
      decryptRefreshToken(
        TEST_ENV,
        "google-connection:2",
        encrypted.keyVersion,
        encrypted.ciphertext,
        encrypted.nonce,
      ),
    ).rejects.toThrow();
  });

  it("暗号文が改ざんされた場合は復号に失敗する", async () => {
    const encrypted = await encryptRefreshToken(TEST_ENV, GOOGLE_CONNECTION_AAD, "secret-token");
    const tamperedBytes = base64UrlToBytes(encrypted.ciphertext);
    tamperedBytes[0] ^= 0xff;
    const tampered = bytesToBase64Url(tamperedBytes);

    await expect(
      decryptRefreshToken(
        TEST_ENV,
        GOOGLE_CONNECTION_AAD,
        encrypted.keyVersion,
        tampered,
        encrypted.nonce,
      ),
    ).rejects.toThrow();
  });

  it("未対応のキーバージョンはエラーになる", async () => {
    const encrypted = await encryptRefreshToken(TEST_ENV, GOOGLE_CONNECTION_AAD, "secret-token");
    await expect(
      decryptRefreshToken(
        TEST_ENV,
        GOOGLE_CONNECTION_AAD,
        2,
        encrypted.ciphertext,
        encrypted.nonce,
      ),
    ).rejects.toThrow(/暗号化鍵バージョン/);
    await expect(
      decryptRefreshToken(
        TEST_ENV,
        GOOGLE_CONNECTION_AAD,
        0,
        encrypted.ciphertext,
        encrypted.nonce,
      ),
    ).rejects.toThrow(/暗号化鍵バージョン/);
  });

  it("鍵が未設定または 32 バイトでない場合はエラーになる", async () => {
    await expect(
      encryptRefreshToken({ GOOGLE_TOKEN_ENCRYPTION_KEY: "" }, GOOGLE_CONNECTION_AAD, "token"),
    ).rejects.toThrow(/設定されていません/);

    const shortKey = Buffer.from(new Uint8Array(16).fill(1)).toString("base64");
    await expect(
      encryptRefreshToken(
        { GOOGLE_TOKEN_ENCRYPTION_KEY: shortKey },
        GOOGLE_CONNECTION_AAD,
        "token",
      ),
    ).rejects.toThrow(/32 バイト/);
  });
});
