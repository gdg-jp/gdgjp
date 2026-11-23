import { isValidImageId } from "./id";

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "_",
  "admin",
  "api",
  "app-icon.png",
  "assets",
  "auth",
  "dev",
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

export function validateSlug(slug: string): SlugValidation {
  if (!SLUG_RE.test(slug)) return { ok: false, reason: "format" };
  if (RESERVED_SLUGS.has(slug.toLowerCase())) return { ok: false, reason: "reserved" };
  if (isValidImageId(slug)) return { ok: false, reason: "looks_like_id" };
  return { ok: true };
}
