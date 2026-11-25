const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function cookieName(eventId: string): string {
  return `scheduler_p_${eventId}`;
}

export function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const chars = new Array<string>(26);
  for (let i = 25; i >= 0; i--) {
    chars[i] = ALPHABET[Number(n & 31n)];
    n >>= 5n;
  }
  return chars.join("");
}

export async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function verify(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const COOKIE_PATH = "/e";
const COOKIE_MAX_AGE_SECONDS = 63072000;

function cookieAttributes(
  nameValue: string,
  path: string,
  maxAge: number,
  options: { secure: boolean },
): string {
  const attrs = [nameValue, "HttpOnly", "SameSite=Lax", `Path=${path}`, `Max-Age=${maxAge}`];
  if (options.secure) attrs.push("Secure");
  return attrs.join("; ");
}

function serializeCookie(
  eventId: string,
  participantId: number,
  token: string,
  options: { secure: boolean },
): string {
  return cookieAttributes(
    `${cookieName(eventId)}=${participantId}.${token}`,
    COOKIE_PATH,
    COOKIE_MAX_AGE_SECONDS,
    options,
  );
}

export function participantCookieHeaders(
  eventId: string,
  participantId: number,
  token: string,
  options: { secure: boolean },
): Headers {
  const headers = new Headers();
  headers.append("Set-Cookie", serializeCookie(eventId, participantId, token, options));
  headers.append(
    "Set-Cookie",
    cookieAttributes(`${cookieName(eventId)}=`, `${COOKIE_PATH}/${eventId}`, 0, options),
  );
  return headers;
}

export type ParticipantCredential = { participantId: number; token: string };

export function parseFromHeader(
  cookieHeader: string | null,
  eventId: string,
): ParticipantCredential[] {
  if (!cookieHeader) return [];
  const name = cookieName(eventId);
  const credentials: ParticipantCredential[] = [];
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq) !== name) continue;
    const value = part.slice(eq + 1);
    const dot = value.indexOf(".");
    if (dot === -1) continue;
    const id = Number.parseInt(value.slice(0, dot), 10);
    const token = value.slice(dot + 1);
    if (!Number.isInteger(id) || id <= 0 || !token) continue;
    credentials.push({ participantId: id, token });
  }
  return credentials;
}
