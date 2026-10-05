/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 *
 * Key material is a versioned map (`TOKEN_ENCRYPTION_KEYS`). Decrypt with the
 * version stored on the record; always encrypt with the highest version.
 * No Redis access — pure crypto, testable in isolation.
 */

export type TokenKeyring = {
  /** Highest numeric version — always used for new ciphertext. */
  currentVersion: number;
  keys: ReadonlyMap<number, Uint8Array>;
};

export type EncryptedPayload = {
  keyVersion: number;
  /** `base64url(iv) . base64url(ciphertext||tag)` */
  ciphertext: string;
};

const IV_BYTES = 12;
const KEY_BYTES = 32;

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

/**
 * Parse `TOKEN_ENCRYPTION_KEYS`: a JSON object of `version → base64(raw 32-byte key)`.
 * The current version is the maximum numeric key.
 */
export function parseTokenEncryptionKeys(json: string): TokenKeyring {
  const trimmed = json.trim();
  if (!trimmed) {
    throw new Error("TOKEN_ENCRYPTION_KEYS is empty");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("TOKEN_ENCRYPTION_KEYS is not valid JSON");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TOKEN_ENCRYPTION_KEYS must be a JSON object of version → base64 key");
  }

  const keys = new Map<number, Uint8Array>();
  for (const [versionRaw, keyRaw] of Object.entries(parsed as Record<string, unknown>)) {
    const version = Number(versionRaw);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`TOKEN_ENCRYPTION_KEYS has invalid version "${versionRaw}"`);
    }
    if (typeof keyRaw !== "string" || !keyRaw.trim()) {
      throw new Error(`TOKEN_ENCRYPTION_KEYS version ${version} key must be a base64 string`);
    }
    const material = new Uint8Array(Buffer.from(keyRaw, "base64"));
    if (material.byteLength !== KEY_BYTES) {
      throw new Error(
        `TOKEN_ENCRYPTION_KEYS version ${version} must decode to ${KEY_BYTES} bytes (AES-256)`,
      );
    }
    keys.set(version, material);
  }

  if (keys.size === 0) {
    throw new Error("TOKEN_ENCRYPTION_KEYS has no keys");
  }

  let currentVersion = 0;
  for (const version of keys.keys()) {
    if (version > currentVersion) currentVersion = version;
  }

  return { currentVersion, keys };
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", arrayBufferOf(raw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypt `plaintext` with the current key version. */
export async function encryptToken(
  plaintext: string,
  keyring: TokenKeyring,
): Promise<EncryptedPayload> {
  const raw = keyring.keys.get(keyring.currentVersion);
  if (!raw) {
    throw new Error(`TOKEN_ENCRYPTION_KEYS missing current version ${keyring.currentVersion}`);
  }

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: arrayBufferOf(iv) },
    await importAesKey(raw),
    new TextEncoder().encode(plaintext),
  );

  return {
    keyVersion: keyring.currentVersion,
    ciphertext: `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(cipher))}`,
  };
}

/** Decrypt using the version recorded on the payload. */
export async function decryptToken(
  payload: EncryptedPayload,
  keyring: TokenKeyring,
): Promise<string> {
  const raw = keyring.keys.get(payload.keyVersion);
  if (!raw) {
    throw new Error(`TOKEN_ENCRYPTION_KEYS missing version ${payload.keyVersion}`);
  }

  const [ivEncoded, cipherEncoded] = payload.ciphertext.split(".");
  if (!ivEncoded || !cipherEncoded) {
    throw new Error("Invalid encrypted payload");
  }

  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: arrayBufferOf(base64UrlDecode(ivEncoded)) },
    await importAesKey(raw),
    arrayBufferOf(base64UrlDecode(cipherEncoded)),
  );
  return new TextDecoder().decode(plain);
}
