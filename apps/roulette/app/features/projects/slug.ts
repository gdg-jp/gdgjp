export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const RESERVED_SLUGS = new Set<string>([
  "admin",
  "api",
  "auth",
  "signin",
  "signout",
  "no-chapter",
  "dev",
  "new",
  "assets",
  "_",
]);

export function normalizeSlug(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  if (RESERVED_SLUGS.has(s)) return null;
  return s;
}
