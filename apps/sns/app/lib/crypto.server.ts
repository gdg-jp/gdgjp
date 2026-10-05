function toBase64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(secret: string, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: arrayBuffer(iv) },
    await encryptionKey(secret),
    new TextEncoder().encode(value),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(secret: string, value: string): Promise<string> {
  const [ivEncoded, cipherEncoded] = value.split(".");
  if (!ivEncoded || !cipherEncoded) throw new Error("Invalid encrypted secret");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: arrayBuffer(fromBase64(ivEncoded)) },
    await encryptionKey(secret),
    arrayBuffer(fromBase64(cipherEncoded)),
  );
  return new TextDecoder().decode(plain);
}
