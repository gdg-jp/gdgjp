import { buffer, base64Decode, base64UrlDecode, base64UrlEncode } from "../../lib";

/**
 * AES-256-GCM for OAuth tokens at rest. Same format as v1 apps/agents
 * (`TOKEN_ENCRYPTION_KEYS` = JSON version → base64 key; ciphertext
 * `base64url(iv).base64url(ct||tag)`), so migrated links decrypt unchanged.
 */
export type TokenKeyring = { currentVersion: number; keys: ReadonlyMap<number, Uint8Array> };
export type EncryptedPayload = { keyVersion: number; ciphertext: string };

export function parseTokenEncryptionKeys(json: string): TokenKeyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.trim());
  } catch {
    throw new Error("TOKEN_ENCRYPTION_KEYS is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TOKEN_ENCRYPTION_KEYS must be a JSON object of version → base64 key");
  }
  const keys = new Map<number, Uint8Array>();
  for (const [versionRaw, keyRaw] of Object.entries(parsed as Record<string, unknown>)) {
    const version = Number(versionRaw);
    if (!Number.isInteger(version) || version < 1)
      throw new Error(`invalid key version "${versionRaw}"`);
    if (typeof keyRaw !== "string") throw new Error(`key ${version} must be a base64 string`);
    const material = base64Decode(keyRaw.trim());
    if (material.byteLength !== 32) throw new Error(`key ${version} must decode to 32 bytes`);
    keys.set(version, material);
  }
  if (keys.size === 0) throw new Error("TOKEN_ENCRYPTION_KEYS has no keys");
  return { currentVersion: Math.max(...keys.keys()), keys };
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", buffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(
  plaintext: string,
  keyring: TokenKeyring,
): Promise<EncryptedPayload> {
  const raw = keyring.keys.get(keyring.currentVersion);
  if (!raw) throw new Error("missing current key");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buffer(iv) },
    await aesKey(raw),
    new TextEncoder().encode(plaintext),
  );
  return {
    keyVersion: keyring.currentVersion,
    ciphertext: `${base64UrlEncode(iv)}.${base64UrlEncode(cipher)}`,
  };
}

export async function decryptToken(
  payload: EncryptedPayload,
  keyring: TokenKeyring,
): Promise<string> {
  const raw = keyring.keys.get(payload.keyVersion);
  if (!raw) throw new Error(`missing key version ${payload.keyVersion}`);
  const [iv, cipher] = payload.ciphertext.split(".");
  if (!iv || !cipher) throw new Error("Invalid encrypted payload");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buffer(base64UrlDecode(iv)) },
    await aesKey(raw),
    buffer(base64UrlDecode(cipher)),
  );
  return new TextDecoder().decode(plain);
}
