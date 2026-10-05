import { isValidImageId } from "./id";

/**
 * Every top-level route segment in app/routes.ts that is matched before the
 * catch-all `:id` route, plus static/asset paths served by the ASSETS binding.
 * A slug equal to any of these would be shadowed and never resolve.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "_",
  "admin",
  "api",
  "app-icon.png",
  "assets",
  "auth",
  "favicon.ico",
  "i",
  "no-chapter",
  "robots.txt",
  "signin",
  "sitemap.xml",
  "static",
]);

export const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export type SlugValidation =
  | { ok: true }
  | { ok: false; reason: "format" | "reserved" | "looks_like_id" };

/**
 * Validates an owner-supplied custom slug. Slugs are stored and matched
 * verbatim (case-sensitively); only the reserved-word check is
 * case-insensitive. A value that also matches `isValidImageId` is rejected so
 * the id and slug namespaces stay disjoint in the public `$id.tsx` route.
 */
export function validateSlug(slug: string): SlugValidation {
  if (!SLUG_RE.test(slug)) return { ok: false, reason: "format" };
  if (RESERVED_SLUGS.has(slug.toLowerCase())) return { ok: false, reason: "reserved" };
  if (isValidImageId(slug)) return { ok: false, reason: "looks_like_id" };
  return { ok: true };
}
