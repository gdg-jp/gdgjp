const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function gatewaySignaturePayload(input: {
  timestamp: string;
  method: string;
  pathname: string;
  hostname: string;
}): string {
  return `${input.timestamp}\n${input.method.toUpperCase()}\n${input.pathname}\n${input.hostname.toLowerCase()}`;
}

export async function signGatewayRequest(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export async function verifyGatewayRequest(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = new Uint8Array(
    signature.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? [],
  );
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(payload));
}
