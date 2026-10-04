const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function encryptedCookie(
  name: string,
  payload: unknown,
  secret: string,
  maxAge: number,
  request: Request,
): Promise<string> {
  return serializeCookie(name, await encrypt(payload, secret), maxAge, request);
}

export async function readEncryptedCookie<T>(
  request: Request,
  name: string,
  secret: string,
): Promise<T | null> {
  const value = readCookie(request.headers.get("Cookie"), name);
  return value ? decrypt<T>(value, secret) : null;
}

async function encrypt(payload: unknown, secret: string): Promise<string> {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  return `${base64Url(iv)}.${base64Url(ciphertext)}`;
}

async function decrypt<T>(value: string, secret: string): Promise<T | null> {
  const [encodedIv, encodedCiphertext, extra] = value.split(".");
  if (!encodedIv || !encodedCiphertext || extra) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { iv: base64UrlBytes(encodedIv), name: "AES-GCM" },
      await encryptionKey(secret),
      base64UrlBytes(encodedCiphertext),
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    return null;
  }
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function serializeCookie(name: string, value: string, maxAge: number, request: Request): string {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${isHttps(request) ? "; Secure" : ""}`;
}

export function clearCookie(name: string, request: Request): string {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${isHttps(request) ? "; Secure" : ""}`;
}

function isHttps(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}
