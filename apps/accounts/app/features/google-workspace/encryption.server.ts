import { bytesToBase64Url } from "~/lib/crypto.server";

// Bumped only when a new GOOGLE_WORKSPACE_ENCRYPTION_KEY_V<n> secret is
// introduced. Rotation procedure: add the new secret, add a `case n:` below,
// bump this constant so new writes use it — existing rows stay on their
// recorded encryptionKeyVersion and are re-encrypted the next time their row
// is written (reconnect), not in place.
export const CURRENT_ENCRYPTION_KEY_VERSION = 1;

function encryptionKeySecret(env: Env, version: number): string {
  switch (version) {
    case 1:
      return env.GOOGLE_WORKSPACE_ENCRYPTION_KEY;
    default:
      throw new Error(`unsupported Google Workspace encryption key version ${version}`);
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptRefreshToken(
  env: Env,
  userId: string,
  refreshToken: string,
): Promise<{ ciphertext: string; nonce: string; keyVersion: number }> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(encryptionKeySecret(env, CURRENT_ENCRYPTION_KEY_VERSION)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(userId) },
    key,
    new TextEncoder().encode(refreshToken),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    nonce: bytesToBase64Url(nonce),
    keyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
  };
}

export async function decryptRefreshToken(
  env: Env,
  userId: string,
  keyVersion: number,
  ciphertext: string,
  nonce: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(encryptionKeySecret(env, keyVersion)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(nonce),
      additionalData: new TextEncoder().encode(userId),
    },
    key,
    base64UrlToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
