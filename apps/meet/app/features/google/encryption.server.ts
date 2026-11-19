/**
 * リフレッシュトークン暗号化に使う鍵バージョン。
 * 新しい鍵へローテーションする際は `GOOGLE_TOKEN_ENCRYPTION_KEY_V<n>` を追加し、
 * `encryptionKeySecret` に case を足したうえで本定数を上げる。
 */
export const CURRENT_ENCRYPTION_KEY_VERSION = 1;

/** 単一行 `google_connection (id = 1)` 用の AES-GCM 追加認証データ（AAD）。 */
export const GOOGLE_CONNECTION_AAD = "google-connection:1";

export type GoogleEncryptionEnv = {
  GOOGLE_TOKEN_ENCRYPTION_KEY: string;
};

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomToken(bytes: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encryptionKeySecret(env: GoogleEncryptionEnv, version: number): string {
  switch (version) {
    case 1: {
      const secret = env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
      if (!secret) {
        throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY が設定されていません");
      }
      return secret;
    }
    default:
      throw new Error(`サポートされていない暗号化鍵バージョンです: ${version}`);
  }
}

async function importAesKey(
  env: GoogleEncryptionEnv,
  version: number,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const rawKey = base64ToBytes(encryptionKeySecret(env, version));
  if (rawKey.byteLength !== 32) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY は 32 バイトの base64 鍵である必要があります");
  }
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [usage]);
}

/**
 * リフレッシュトークンを AES-256-GCM で暗号化する。
 * `aad` は行識別子（例: `google-connection:1`）を束縛するために使用する。
 */
export async function encryptRefreshToken(
  env: GoogleEncryptionEnv,
  aad: string,
  refreshToken: string,
): Promise<{ ciphertext: string; nonce: string; keyVersion: number }> {
  const key = await importAesKey(env, CURRENT_ENCRYPTION_KEY_VERSION, "encrypt");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(refreshToken),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    nonce: bytesToBase64Url(nonce),
    keyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
  };
}

/**
 * 暗号化済みリフレッシュトークンを `keyVersion` に対応する鍵で復号する。
 */
export async function decryptRefreshToken(
  env: GoogleEncryptionEnv,
  aad: string,
  keyVersion: number,
  ciphertext: string,
  nonce: string,
): Promise<string> {
  const key = await importAesKey(env, keyVersion, "decrypt");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(nonce),
      additionalData: new TextEncoder().encode(aad),
    },
    key,
    base64UrlToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
