// Signed-cookie helpers shared by the IdP login session and the RP session.
// Uses HMAC-SHA256 over a JSON payload; payload is opaque base64url.

const ALG = { name: "HMAC", hash: "SHA-256" } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), ALG, false, ["sign", "verify"]);
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function signPayload<T>(payload: T, secret: string): Promise<string> {
  const key = await importKey(secret);
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign(ALG, key, encoder.encode(body)));
  return `${body}.${b64urlEncode(sig)}`;
}

export async function verifyPayload<T>(value: string, secret: string): Promise<T | null> {
  const idx = value.indexOf(".");
  if (idx <= 0) return null;
  const body = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const key = await importKey(secret);
  let ok: boolean;
  try {
    ok = await crypto.subtle.verify(ALG, key, b64urlDecode(sig), encoder.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    return JSON.parse(decoder.decode(b64urlDecode(body))) as T;
  } catch {
    return null;
  }
}

export interface CookieOptions {
  name: string;
  value: string;
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
}

export function serializeCookie(opts: CookieOptions): string {
  const parts = [`${opts.name}=${opts.value}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.secure !== false) parts.push("Secure");
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function readCookie(request: Request, name: string): string | null {
  return parseCookies(request.headers.get("cookie"))[name] ?? null;
}

export function clearedCookie(name: string, path = "/"): string {
  return serializeCookie({
    name,
    value: "",
    path,
    expires: new Date(0),
    maxAge: 0,
  });
}
