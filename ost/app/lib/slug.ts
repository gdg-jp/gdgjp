/**
 * Event slug rules. A slug is the public URL segment: `ost.gdgs.jp/:slug`.
 * Pure + unit-tested; imported by the create action and defensively by every
 * `:slug` loader.
 */

// 1–40 chars, lowercase letters/digits/hyphens, no leading/trailing hyphen.
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Path segments that must never resolve to an event. */
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

/**
 * Normalize a raw slug input. Returns the cleaned slug, or `null` when it is
 * unusable (wrong shape, reserved, or contains a dot).
 */
export function normalizeSlug(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  if (s.includes(".")) return null;
  if (isReservedSlug(s)) return null;
  return s;
}
