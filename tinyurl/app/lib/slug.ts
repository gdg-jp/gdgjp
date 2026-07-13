export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "_",
  "admin",
  "analytics",
  "api",
  "app",
  "assets",
  "campaigns",
  "dashboard",
  "favicon.ico",
  "links",
  "notfound",
  "r",
  "robots.txt",
  "settings",
  "signin",
  "signup",
  "sitemap.xml",
  "static",
  "tags",
]);

export const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export type SlugValidation = { ok: true } | { ok: false; reason: "format" | "reserved" };

export function validateSlug(slug: string): SlugValidation {
  if (!SLUG_RE.test(slug)) return { ok: false, reason: "format" };
  if (RESERVED_SLUGS.has(slug.toLowerCase())) return { ok: false, reason: "reserved" };
  return { ok: true };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateRandomSlug(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
