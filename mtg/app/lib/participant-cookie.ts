const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function cookieName(eventId: string): string {
  return `mtg_p_${eventId}`;
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

export function serializeCookie(
  eventId: string,
  participantId: number,
  token: string,
  options: { secure: boolean },
): string {
  const value = `${participantId}.${token}`;
  const attrs = [
    `${cookieName(eventId)}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=/e/${eventId}`,
    "Max-Age=63072000",
  ];
  if (options.secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function parseFromHeader(
  cookieHeader: string | null,
  eventId: string,
): { participantId: number; token: string } | null {
  if (!cookieHeader) return null;
  const name = cookieName(eventId);
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) !== name) continue;
    const value = part.slice(eq + 1);
    const dot = value.indexOf(".");
    if (dot === -1) return null;
    const idStr = value.slice(0, dot);
    const token = value.slice(dot + 1);
    const id = Number.parseInt(idStr, 10);
    if (!Number.isInteger(id) || id <= 0 || !token) return null;
    return { participantId: id, token };
  }
  return null;
}
