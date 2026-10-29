/**
 * Project slug rules. A slug is the public URL segment: `roulette.gdgs.jp/:slug`.
 * Pure + unit-tested; imported by the create action and defensively by every
 * `:slug` loader.
 */

// 1–40 chars, lowercase letters/digits/hyphens, no leading/trailing hyphen.
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Path segments that must never resolve to a project. */
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

/**
 * Normalize a raw slug input. Returns the cleaned slug, or `null` when it is
 * unusable (wrong shape or reserved).
 */
export function normalizeSlug(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  if (RESERVED_SLUGS.has(s)) return null;
  return s;
}
