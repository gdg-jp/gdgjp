export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const RESERVED_SLUGS = new Set<string>([
  "api",
  "auth",
  "signin",
  "signout",
  "no-chapter",
  "ws",
  "dev",
  "new",
  "admin",
  "assets",
  "favicon.svg",
  "robots.txt",
  "app-icon.png",
  "_",
]);

export function isReservedSlug(s: string): boolean {
  return RESERVED_SLUGS.has(s);
}

export function normalizeSlug(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  if (s.includes(".")) return null;
  if (isReservedSlug(s)) return null;
  return s;
}
